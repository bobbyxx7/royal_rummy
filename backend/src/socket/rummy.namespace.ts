import { Server } from 'socket.io';
import {
  TABLE_ROOM,
  createOrFindTable,
  findSessionBySocket,
  games,
    clientCardToCode,
  joinTable,
  sessions,
  startGameForTable,
  userIdToSocket,
  waitingTables,
} from './state';
import { validateUserToken } from '../auth';
import { isDbConnected } from '../auth';
import { RoundResultModel, UserModel, WalletLedgerModel } from '../db';
import { usersById } from '../services/auth.routes';
import { validateDeclare as serverValidateDeclare, computeHandPoints } from './rules';
import { emitWalletUpdate } from './emitter';

export function rummyNamespace(io: Server) {
  // Redis adapter omitted by request (single-instance mode)
  const nsp = io.of('/rummy');

  // Simple per-socket rate limiter
  const lastEventTs = new Map<string, Record<string, number>>();
  function isRateLimited(socketId: string, event: string, minMs: number): boolean {
    const now = Date.now();
    const rec = lastEventTs.get(socketId) || {};
    const prev = rec[event] || 0;
    if (now - prev < minMs) {
      return true;
    }
    rec[event] = now;
    lastEventTs.set(socketId, rec);
    return false;
  }

  // Seed a couple of default waiting tables for quick-join
  try {
    if (waitingTables.size === 0) {
      createOrFindTable('80', 2);
      createOrFindTable('800', 2);
    }
  } catch {}

  // Naive bot scheduler for testing
  const botTimers = new Map<string, NodeJS.Timeout>(); // gameId -> timer
  const turnTimers = new Map<string, NodeJS.Timeout>(); // gameId -> timeout that fires on turn end
  const turnTickIntervals = new Map<string, NodeJS.Timeout>(); // gameId -> per-second tick interval
  function isBot(userId: string | undefined) { return typeof userId === 'string' && userId.startsWith('bot:'); }
  function scheduleBotTurn(gameId: string) {
    if (botTimers.has(gameId)) return;
    const run = () => {
      const game = games.get(gameId);
      if (!game) return;
      const seat = game.currentTurn;
      const userId = game.players[seat];
      if (!isBot(userId)) { botTimers.delete(gameId); return; }
      // Bot move: draw from deck, then discard a random card
      const card = game.deck.shift() || null;
      if (card) {
        game.playersHands[seat].push(card);
      }
      // random discard from hand
      const hand = game.playersHands[seat];
      const idx = hand.length ? Math.floor(Math.random() * hand.length) : -1;
      if (idx >= 0) {
        const discarded = hand.splice(idx, 1)[0];
        game.discardPile.push(discarded);
      }
      // advance turn and broadcast
      const totalSeats = game.players.filter(Boolean).length;
      game.currentTurn = (game.currentTurn + 1) % Math.max(totalSeats, 1);
      nsp.to(TABLE_ROOM(game.tableId)).emit('status', {
        code: 200,
        message: 'BotMove',
        discardTop: game.discardPile[game.discardPile.length - 1] || null,
        currentTurn: game.currentTurn,
        game_id: game.id,
        seats: game.players,
        packed: game.packed,
        deckCount: game.deck.length,
        phase: game.phase,
      });
      // schedule next if next is also bot
      const nextUser = game.players[game.currentTurn];
      if (isBot(nextUser)) {
        const t = setTimeout(run, 1200);
        botTimers.set(gameId, t);
      } else {
        botTimers.delete(gameId);
      }
    };
    const t = setTimeout(run, 1200);
    botTimers.set(gameId, t);
  }

  function clearTurnTimer(gameId: string) {
    const t = turnTimers.get(gameId);
    if (t) {
      clearTimeout(t);
      turnTimers.delete(gameId);
    }
    const tick = turnTickIntervals.get(gameId);
    if (tick) {
      clearInterval(tick);
      turnTickIntervals.delete(gameId);
    }
  }

  function scheduleTurnTimer(gameId: string) {
    clearTurnTimer(gameId);
    const game = games.get(gameId);
    if (!game) return;
    const turnMs = 30000; // strict 30 seconds per turn
    const deadline = Date.now() + turnMs;
    // Per-second tick broadcast
    try {
      const tick = setInterval(() => {
        const g = games.get(gameId);
        if (!g) { clearTurnTimer(gameId); return; }
        const remainingMs = Math.max(0, deadline - Date.now());
        const remainingSeconds = Math.ceil(remainingMs / 1000);
        // Broadcast current turn + remaining seconds to table
        io.of('/rummy').to(TABLE_ROOM(g.tableId)).emit('turn-tick', {
          currentTurn: g.currentTurn,
          remainingSeconds,
          game_id: g.id,
        });
        if (remainingMs <= 0) {
          // let the timeout handler advance turn; interval will be cleared there
        }
      }, 1000);
      turnTickIntervals.set(gameId, tick);
    } catch {}
    const t = setTimeout(async () => {
      const g = games.get(gameId);
      if (!g) return;
      // Auto-drop (pack) the current player on timeout
      const seat = g.currentTurn;
      g.packed[seat] = true;
      g.drawnThisTurn[seat] = false;
      nsp.to(TABLE_ROOM(g.tableId)).emit('status', {
        code: 200,
        message: 'Packed',
        game_id: g.id,
        currentTurn: g.currentTurn,
        deckCount: g.deck.length,
        discardTop: g.discardPile[g.discardPile.length - 1] || null,
        seats: g.players,
        phase: g.phase,
      });
      // If only one active player remains, conclude round
      const activeSeats = g.players.map((uid, i) => ({ uid, i })).filter(p => p.uid && !g.packed[p.i]);
      if (activeSeats.length <= 1) {
        const winnerUserId = activeSeats[0]?.uid || g.players.find(u => !!u) || '';
        const MAX_POINTS = Number(process.env.MAX_POINTS || 80);
        const FIRST_DROP = Number(process.env.FIRST_DROP || 20);
        const MIDDLE_DROP = Number(process.env.MIDDLE_DROP || 40);
        const points = g.players.map((uid, i) => {
          if (!uid) return { user_id: uid, seat: i, points: 0 };
          if (uid === winnerUserId) return { user_id: uid, seat: i, points: 0 };
          if (g.packed[i]) {
            const p = g.hasPlayedAnyTurn[i] ? MIDDLE_DROP : FIRST_DROP;
            return { user_id: uid, seat: i, points: Math.min(p, MAX_POINTS) };
          }
          const hand = g.playersHands[i] || [];
          const { points: deadwood } = computeHandPoints(hand, g.playersGroups[i], g.wildCardRank);
          return { user_id: uid, seat: i, points: Math.min(deadwood, MAX_POINTS) };
        });
        const rakePercent = Math.max(0, Math.min(100, Number(process.env.RAKE_PERCENT || 0)));
        const summary = {
          code: 200,
          message: 'RoundEnd',
          game_id: g.id,
          table_id: g.tableId,
          winner_user_id: winnerUserId,
          points,
          point_value: g.pointValue,
          rake: rakePercent,
        } as const;
        nsp.to(TABLE_ROOM(g.tableId)).emit('round-end', summary);
        clearTurnTimer(g.id);
        if (isDbConnected()) {
          const totalLoserPoints = points.filter(p => p.user_id !== winnerUserId).reduce((acc, p) => acc + (p.points || 0), 0);
          const grossWinnerAmount = totalLoserPoints * g.pointValue;
          const rakeAmount = Math.round((grossWinnerAmount * rakePercent)) / 100;
          const netWinnerAmount = grossWinnerAmount - rakeAmount;
          const deltas = points.map((p) => ({
            ...p,
            delta: p.user_id === winnerUserId ? netWinnerAmount : -(p.points * g.pointValue),
          }));
          try {
            await RoundResultModel.create({
              tableId: g.tableId,
              gameId: g.id,
              pointValue: g.pointValue,
              winnerUserId,
              points: deltas,
              rake: rakePercent,
            });
          } catch {}
          await Promise.all(deltas.map(async (d) => {
            const delta = Number(d.delta || 0);
            if (!Number.isFinite(delta)) return;
            try {
              await UserModel.updateOne({ _id: d.user_id }, [{
                $set: {
                  wallet: {
                    $toString: { $round: [{ $add: [{ $toDouble: '$wallet' }, delta] }, 2] }
                  }
                }
              }]).exec();
              const updated = await UserModel.findById(d.user_id).select('wallet').lean().exec();
              await WalletLedgerModel.create({ userId: d.user_id, delta, reason: 'round_settlement', ref: g.id, balanceAfter: updated?.wallet });
              if (updated?.wallet != null) emitWalletUpdate(String(d.user_id), String(updated.wallet), 'round_settlement', g.id);
            } catch {}
          }));
          try {
            if (rakeAmount > 0 && process.env.RAKE_WALLET_USER_ID) {
              const rakeUserId = String(process.env.RAKE_WALLET_USER_ID);
              await UserModel.updateOne({ _id: rakeUserId }, [{ $set: { wallet: { $toString: { $round: [{ $add: [{ $toDouble: '$wallet' }, rakeAmount] }, 2] } } } }]).exec();
              const updated = await UserModel.findById(rakeUserId).select('wallet').lean().exec();
              await WalletLedgerModel.create({ userId: rakeUserId, delta: rakeAmount, reason: 'rake', ref: g.id, balanceAfter: updated?.wallet });
            }
          } catch {}
        }
        const tbl = waitingTables.get(g.tableId);
        if (tbl) { tbl.status = 'waiting'; tbl.players = Array(tbl.noOfPlayers).fill(''); }
        games.delete(g.id);
        return;
      }
      // Find next non-packed seat
      let next = (seat + 1) % Math.max(g.players.length, 1);
      for (let i = 0; i < g.players.length; i++) {
        const idx = (seat + 1 + i) % g.players.length;
        const uid = g.players[idx];
        if (uid && !g.packed[idx]) { next = idx; break; }
      }
      g.currentTurn = next;
      nsp.to(TABLE_ROOM(g.tableId)).emit('status', {
        code: 200,
        message: 'TurnTimeoutPacked',
        discardTop: g.discardPile[g.discardPile.length - 1] || null,
        currentTurn: g.currentTurn,
        game_id: g.id,
        seats: g.players,
          packed: g.packed,
        deckCount: g.deck.length,
        phase: g.phase,
      });
      if (isBot(g.players[g.currentTurn])) scheduleBotTurn(g.id);
      scheduleTurnTimer(g.id);
    }, turnMs);
    turnTimers.set(gameId, t);
  }

  nsp.on('connection', async (socket) => {
    // eslint-disable-next-line no-console
    console.log(`[socket] connected: ${socket.id}`);

    const { userId, token } = socket.handshake.query as { userId?: string; token?: string };
    if (userId && typeof userId === 'string') {
      const ok = await validateUserToken(userId, typeof token === 'string' ? token : undefined);
      if (!ok) {
        socket.disconnect(true);
        return;
      }
      sessions.set(socket.id, { socketId: socket.id, userId, token: typeof token === 'string' ? token : undefined });
      userIdToSocket.set(userId, socket.id);
    }

    // Health check event used by connectivity service
    socket.on('health_check', (payload) => {
      socket.emit('health_ok', { ok: true, ts: Date.now(), echo: payload });
    });

    // Generic ping support (client also sends periodic pings)
    socket.on('ping', (data) => {
      socket.emit('pong', data ?? 'pong');
    });

    // get-table matchmaking
    socket.on('get-table', async (payload) => {
      if (isRateLimited(socket.id, 'get-table', 500)) return;
      try {
      const session = findSessionBySocket(socket.id);
        if (!session) return;
      const { user_id, token: payloadToken, boot_value, no_of_players } = payload || {};
      const tokenToCheck = String(payloadToken || session.token || '');
      const ok = await validateUserToken(String(user_id || session.userId), tokenToCheck);
        if (!ok) { socket.emit('get-table', { code: 401, message: 'Unauthorized' }); return; }
        // TODO: validate token for prod
        const table = createOrFindTable(String(boot_value ?? '0'), Number(no_of_players ?? 2));
        socket.join(TABLE_ROOM(table.id));
        session.tableId = table.id;
        socket.emit('get-table', {
          code: 200,
          message: 'Success',
          table_id: table.id,
          boot_value: table.bootValue,
          no_of_players: table.noOfPlayers,
        });
      } catch (e) {
        socket.emit('get-table', { code: 500, message: 'error' });
      }
    });

    // join-table
    socket.on('join-table', async (payload) => {
      if (isRateLimited(socket.id, 'join-table', 500)) return;
      const session = findSessionBySocket(socket.id);
      if (!session) return;
      const { user_id, token: payloadToken, table_id } = payload || {};
      const tokenToCheck = String(payloadToken || session.token || '');
      const ok = await validateUserToken(String(user_id || session.userId), tokenToCheck);
      if (!ok) { socket.emit('join-table', { code: 401, message: 'Unauthorized' }); return; }
      const table = waitingTables.get(String(table_id || session.tableId || ''));
      if (!table) {
        socket.emit('join-table', { code: 404, message: 'Table not found' });
        return;
      }
      // Wallet reserve check: require min(wallet) >= max(bootValue, MAX_POINTS*pointValue)
      try {
        const RESERVE_POINTS = Number(process.env.MAX_POINTS || 80);
        const reserveByPoints = RESERVE_POINTS * (table.pointValue || Number(process.env.POINT_VALUE || 1));
        const reserveByBoot = Number(table.bootValue || '0');
        const reserveMin = Math.max(reserveByPoints, reserveByBoot, 0);
        let walletStr: string | undefined;
        if (isDbConnected()) {
          const dbUser = await UserModel.findById(user_id).select('wallet').lean().exec();
          walletStr = dbUser?.wallet;
        } else {
          const mem = usersById.get(String(user_id));
          walletStr = mem?.wallet;
        }
        const wallet = Number(walletStr || '0');
        if (!Number.isFinite(wallet) || wallet < reserveMin) {
          socket.emit('join-table', { code: 402, message: 'Insufficient wallet', required: reserveMin });
          return;
        }
      } catch {}
      const joined = joinTable(table, String(user_id));
      if (!joined) {
        socket.emit('join-table', { code: 409, message: 'Table full' });
        return;
      }
      session.tableId = table.id;
      session.seatNo = joined.seatNo;
      socket.join(TABLE_ROOM(table.id));
      socket.emit('join-table', { code: 200, message: 'Success', table_id: table.id, seat_no: joined.seatNo });

      // Notify room about current player count
      const joinedCount = table.players.filter(Boolean).length;
      nsp.to(TABLE_ROOM(table.id)).emit('table-joined', {
        code: 200,
        message: 'Player joined',
        table_id: table.id,
        joined: joinedCount,
        total: table.noOfPlayers,
      });

      // Auto-fill with bots in dev/practice to start immediately if configured
      let filled = table.players.filter(Boolean).length >= table.noOfPlayers;
      const autoFill = (process.env.AUTO_FILL_BOT ?? '1') !== '0';
      if (!filled && autoFill) {
        for (let i = 0; i < table.noOfPlayers; i++) {
          if (!table.players[i]) table.players[i] = `bot:${Math.random().toString(36).slice(2, 7)}`;
        }
        filled = true;
      }

      // Auto-start when table fills
      // const filled = table.players.filter(Boolean).length >= table.noOfPlayers;
      if (filled) {
        // PHASE 1: Seating + toss broadcast (no dealing yet)
        const game = startGameForTable(table);
        // Align session seat numbers with post-toss seating order
        try {
          for (let i = 0; i < game.players.length; i++) {
            const uid = game.players[i];
            if (!uid) continue;
            const sid = userIdToSocket.get(uid);
            if (!sid) continue;
            const sess = sessions.get(sid);
            if (sess) sess.seatNo = i;
          }
        } catch {}
        // Initial broadcast: Toss (phase already set to 'started' post-deal, emulate early phases)
        try {
          game.phase = 'toss';
        nsp.to(TABLE_ROOM(table.id)).emit('start-game', {
          code: 200,
          message: 'Success',
          game_id: game.id,
          table_id: table.id,
          wildCardRank: game.wildCardRank,
          currentTurn: game.currentTurn,
          seats: game.players,
          toss: { winnerSeat: game.toss?.winnerSeat, winnerUserId: game.toss?.winnerUserId, cardsByUser: game.toss?.cardsByUser },
            phase: game.phase,
          });
        } catch {}
        // Show toss for ~3 seconds, then send dealing status and hands
        setTimeout(async () => {
          try {
            game.phase = 'dealing';
            nsp.to(TABLE_ROOM(table.id)).emit('status', {
              code: 200,
              message: 'Dealing',
              game_id: game.id,
              currentTurn: game.currentTurn,
              deckCount: game.deck.length,
              discardTop: game.discardPile[game.discardPile.length - 1] || null,
              seats: game.players,
              packed: game.packed,
              phase: game.phase,
            });
            // Send each player's hand privately after toss delay (authoritative)
            for (let seat = 0; seat < game.players.length; seat++) {
              const uid = game.players[seat];
              if (!uid) continue;
              const sid = userIdToSocket.get(uid);
              if (!sid) continue;
              nsp.to(sid).emit('my-card', { code: 200, message: 'Success', hand: game.playersHands[seat] || [] });
            }
            // Transition to started and kick off turn timer
            game.phase = 'started';
            // Immediately follow with a status update to avoid any clients clearing UI due to phase change
            nsp.to(TABLE_ROOM(table.id)).emit('status', {
              code: 200,
              message: 'Success',
              game_id: game.id,
              currentTurn: game.currentTurn,
              deckCount: game.deck.length,
              discardTop: game.discardPile[game.discardPile.length - 1] || null,
              seats: game.players,
              packed: game.packed,
              phase: game.phase,
            });
            scheduleTurnTimer(game.id);
            if (isBot(game.players[game.currentTurn])) scheduleBotTurn(game.id);
          } catch {}
        }, 3000);
      }
    });

    // status
    socket.on('status', async (payload) => {
      if (isRateLimited(socket.id, 'status', 500)) return;
      const { game_id } = payload || {};
      const session = findSessionBySocket(socket.id);
      if (session && (payload?.user_id || session.userId)) {
        const userToCheck = String(payload?.user_id || session.userId);
        const tokenToCheck = String(payload?.token || session.token || '');
        const ok = await validateUserToken(userToCheck, tokenToCheck);
        if (!ok) { socket.emit('status', { code: 401, message: 'Unauthorized' }); return; }
      }
      const game = games.get(String(game_id || ''));
      if (!game) {
        socket.emit('status', { code: 404, message: 'Game not found' });
        return;
      }
      // Compute action permissions for this requester
      let canDrawClosed = false;
      let canDrawOpen = false;
      let canDiscard = false;
      let myGroups: string[][] | undefined = undefined;
      try {
        if (session) {
          const seat = session.seatNo ?? game.players.findIndex((u) => u === session.userId);
          const isMyTurn = seat >= 0 && seat === game.currentTurn;
          const isPacked = seat >= 0 ? !!game.packed[seat] : true;
          const hasDrawn = seat >= 0 ? !!game.drawnThisTurn[seat] : false;
          canDrawClosed = isMyTurn && !isPacked && !hasDrawn;
          canDrawOpen = isMyTurn && !isPacked && !hasDrawn && (game.discardPile.length > 0);
          canDiscard = isMyTurn && !isPacked && hasDrawn;
          if (seat >= 0) myGroups = game.playersGroups[seat] || [];
        }
      } catch {}
      socket.emit('status', {
        code: 200,
        message: 'Success',
        game_id: game.id,
        currentTurn: game.currentTurn,
        deckCount: game.deck.length,
        discardTop: game.discardPile[game.discardPile.length - 1] || null,
        seats: game.players,
        packed: game.packed,
        phase: game.phase,
        canDrawClosed,
        canDrawOpen,
        canDiscard,
        myGroups,
      });
      // Proactively provide current hand only after toss phase to avoid early reveal
      try {
        if (game.phase !== 'toss') {
          const session2 = findSessionBySocket(socket.id);
          if (session2) {
            const seat2 = session2.seatNo ?? game.players.findIndex((u) => u === session2.userId);
            if (seat2 != null && seat2 >= 0 && Array.isArray(game.playersHands[seat2]) && game.playersHands[seat2].length > 0) {
              nsp.to(socket.id).emit('my-card', { code: 200, message: 'Success', hand: game.playersHands[seat2] });
            }
          }
        }
      } catch {}
    });

    // my-card: return the player hand for current game
    socket.on('my-card', async (_payload) => {
      if (isRateLimited(socket.id, 'my-card', 500)) return;
      const session = findSessionBySocket(socket.id);
      if (!session || !session.tableId) return;
      // Optional auth: when DB is connected, validate session token
      try {
        if (isDbConnected()) {
          const ok = await validateUserToken(session.userId, session.token);
          if (!ok) { socket.emit('my-card', { code: 401, message: 'Unauthorized' }); return; }
        }
      } catch {}
      const game = [...games.values()].find((g) => g.tableId === session.tableId);
      if (!game) {
        socket.emit('my-card', { code: 404, message: 'Game not found' });
        return;
      }
      // no-op: session token was verified on connection and per-event for status
      const seat = session.seatNo ?? game.players.findIndex((u) => u === session.userId);
      const hand = seat >= 0 ? game.playersHands[seat] : [];
      // Always send authoritative hand for requester; client should fully replace its local hand
      socket.emit('my-card', { code: 200, message: 'Success', hand });
    });

    // get-card: draw from deck to player hand, emit updated hand
    socket.on('get-card', async (_payload) => {
      if (isRateLimited(socket.id, 'get-card', 800)) return;
      const session = findSessionBySocket(socket.id);
      if (!session || !session.tableId) return;
      // Enforce token when DB is connected
      try {
        if (isDbConnected()) {
          const ok = await validateUserToken(session.userId, session.token);
          if (!ok) { socket.emit('get-card', { code: 401, message: 'Unauthorized' }); return; }
        }
      } catch {}
      const game = [...games.values()].find((g) => g.tableId === session.tableId);
      if (!game) return;
      // Ensure it's the player's turn to draw
      const seat = session.seatNo ?? game.players.findIndex((u) => u === session.userId);
      if (seat !== game.currentTurn) { socket.emit('get-card', { code: 409, message: 'Not your turn' }); return; }
      if (game.drawnThisTurn[seat]) { socket.emit('get-card', { code: 409, message: 'Already drew a card this turn' }); return; }
      if (seat < 0 || game.packed[seat]) { socket.emit('get-card', { code: 409, message: 'Packed user cannot draw' }); return; }
      const card = game.deck.shift() || null;
      if (card && seat >= 0) {
        game.playersHands[seat].push(card);
        game.drawnThisTurn[seat] = true;
        game.hasPlayedAnyTurn[seat] = true;
        game.lastDrawnCard[seat] = card;
        game.lastDrawnFrom[seat] = 'closed';
      }
      socket.emit('get-card', { code: 200, message: 'Success', card, hand: seat >= 0 ? game.playersHands[seat] : [] });
      scheduleTurnTimer(game.id);
    });

    // get-drop-card: peek top discard and give it
    socket.on('get-drop-card', async (_payload) => {
      if (isRateLimited(socket.id, 'get-drop-card', 800)) return;
      const session = findSessionBySocket(socket.id);
      if (!session || !session.tableId) return;
      // Enforce token when DB is connected
      try {
        if (isDbConnected()) {
          const ok = await validateUserToken(session.userId, session.token);
          if (!ok) { socket.emit('get-drop-card', { code: 401, message: 'Unauthorized' }); return; }
        }
      } catch {}
      const game = [...games.values()].find((g) => g.tableId === session.tableId);
      if (!game) return;
      // Ensure it's the player's turn to draw from discard
      const seat = session.seatNo ?? game.players.findIndex((u) => u === session.userId);
      if (seat !== game.currentTurn) { socket.emit('get-drop-card', { code: 409, message: 'Not your turn' }); return; }
      if (game.drawnThisTurn[seat]) { socket.emit('get-drop-card', { code: 409, message: 'Already drew a card this turn' }); return; }
      if (seat < 0 || game.packed[seat]) { socket.emit('get-drop-card', { code: 409, message: 'Packed user cannot draw' }); return; }
      const card = game.discardPile.pop() || null;
      if (card && seat >= 0) {
        game.playersHands[seat].push(card);
        game.drawnThisTurn[seat] = true;
        game.lastDrawnCard[seat] = card;
        game.lastDrawnFrom[seat] = 'open';
      }
      socket.emit('get-drop-card', { code: 200, message: 'Success', card, hand: seat >= 0 ? game.playersHands[seat] : [] });
      scheduleTurnTimer(game.id);
    });

    // discardCard: client sends full card object, server converts to code and discards
    socket.on('discardCard', async (payload) => {
      if (isRateLimited(socket.id, 'discardCard', 500)) return;
      const session = findSessionBySocket(socket.id);
      if (!session || !session.tableId) return;
      try {
        if (isDbConnected()) {
          const ok = await validateUserToken(session.userId, session.token);
          if (!ok) { socket.emit('discardCard', { code: 401, message: 'Unauthorized' }); return; }
        }
      } catch {}
      const game = [...games.values()].find((g) => g.tableId === session.tableId);
      if (!game) return;
      const seat = session.seatNo ?? game.players.findIndex((u) => u === session.userId);
      if (seat < 0 || game.packed[seat]) { socket.emit('status', { code: 409, message: 'Packed user cannot discard' }); return; }
      const code = clientCardToCode(payload?.card);
      if (!code || seat < 0) return;
      // Enforce draw-then-discard and turn ownership
      if (seat !== game.currentTurn || !game.drawnThisTurn[seat]) {
        socket.emit('status', { code: 409, message: 'Not your turn or you must draw before discarding' });
        return;
      }
      // Open-card constraint: cannot discard the same card drawn from open pile
      if (game.lastDrawnFrom[seat] === 'open' && game.lastDrawnCard[seat] === code) {
        socket.emit('status', { code: 409, message: 'Cannot discard the card picked from open pile this turn' });
        return;
      }
      // remove from hand if present
      const idx = game.playersHands[seat].indexOf(code);
      if (idx >= 0) game.playersHands[seat].splice(idx, 1);
      game.discardPile.push(code);
      game.lastDrawnCard[seat] = null;
      game.lastDrawnFrom[seat] = null;
      // advance turn
      game.drawnThisTurn[seat] = false;
      const totalSeats = game.players.filter(Boolean).length;
      game.currentTurn = (game.currentTurn + 1) % Math.max(totalSeats, 1);
      nsp.to(TABLE_ROOM(game.tableId)).emit('status', {
        code: 200,
        message: 'Discarded',
        discardTop: code,
        currentTurn: game.currentTurn,
        packed: game.packed,
        deckCount: game.deck.length,
        seats: game.players,
        phase: game.phase,
      });
      // If next is a bot, schedule
      if (isBot(game.players[game.currentTurn])) {
        scheduleBotTurn(game.id);
      }
      scheduleTurnTimer(game.id);
    });

    // group-cards: persist current player groups (UI arrangement), not used for validation mid-hand
    socket.on('group-cards', async (payload) => {
      if (isRateLimited(socket.id, 'group-cards', 500)) return;
      const session = findSessionBySocket(socket.id);
      if (!session || !session.tableId) return;
      try {
        if (isDbConnected()) {
          const ok = await validateUserToken(session.userId, session.token);
          if (!ok) { socket.emit('group-cards', { code: 401, message: 'Unauthorized' }); return; }
        }
      } catch {}
      const game = [...games.values()].find((g) => g.tableId === session.tableId);
      if (!game) return;
      const seat = session.seatNo ?? game.players.findIndex((u) => u === session.userId);
      if (seat < 0) return;
      if (game.packed[seat]) { socket.emit('group-cards', { code: 409, message: 'Packed user cannot group' }); return; }
      const groups = Array.isArray(payload?.groups) ? payload.groups : [];
      // Shallow validation: ensure codes belong to player's hand
      const handSet = new Set(game.playersHands[seat]);
      for (const group of groups) {
        if (!Array.isArray(group)) return;
        for (const code of group) {
          if (!handSet.has(code)) return;
        }
      }
      game.playersGroups[seat] = groups;
      socket.emit('group-cards', { code: 200, message: 'Success' });
    });

    // pack-game: user packs; for now just acknowledge
    socket.on('pack-game', async (payload) => {
      if (isRateLimited(socket.id, 'pack-game', 800)) return;
      const { game_id } = payload || {};
      const game = games.get(String(game_id || ''));
      if (!game) {
        socket.emit('pack-game', { code: 404, message: 'Game not found' });
        return;
      }
      const session = findSessionBySocket(socket.id);
      if (!session) { socket.emit('pack-game', { code: 401, message: 'Unauthorized' }); return; }
      try {
        if (isDbConnected()) {
          const ok = await validateUserToken(session.userId, session.token);
          if (!ok) { socket.emit('pack-game', { code: 401, message: 'Unauthorized' }); return; }
        }
      } catch {}
      const seat = game.players.findIndex((u) => u === session.userId);
      if (seat < 0) { socket.emit('pack-game', { code: 404, message: 'Seat not found' }); return; }
      game.packed[seat] = true;
      // Broadcast status update
      nsp.to(TABLE_ROOM(game.tableId)).emit('status', {
        code: 200,
        message: 'Packed',
        game_id: game.id,
        currentTurn: game.currentTurn,
        deckCount: game.deck.length,
        discardTop: game.discardPile[game.discardPile.length - 1] || null,
        seats: game.players,
        packed: game.packed,
        phase: game.phase,
      });
      socket.emit('pack-game', { code: 200, message: 'Success' });
      scheduleTurnTimer(game.id);
    });

    // declare: validate groups; if valid, end round and broadcast a summary
    socket.on('declare', async (payload) => {
      if (isRateLimited(socket.id, 'declare', 1000)) return;
      try {
        const session = findSessionBySocket(socket.id);
        if (!session) { socket.emit('declare', { code: 401, message: 'Unauthorized' }); return; }
        try {
          if (isDbConnected()) {
            const ok = await validateUserToken(session.userId, session.token);
            if (!ok) { socket.emit('declare', { code: 401, message: 'Unauthorized' }); return; }
          }
        } catch {}
        // Validate against wild rank from game
        const gameForDeclare = session.tableId ? [...games.values()].find(g => g.tableId === session.tableId) : undefined;
        const wildRank = gameForDeclare?.wildCardRank;
        if (gameForDeclare) {
          const seat = gameForDeclare.players.findIndex((u) => u === session.userId);
          if (seat >= 0 && gameForDeclare.packed[seat]) { socket.emit('declare', { code: 409, message: 'Packed user cannot declare' }); return; }
        }
        const groups = Array.isArray(payload?.groups) ? payload.groups : [];
        // Require a finish card for declaration (discard to finish slot)
        const finishCode = clientCardToCode(payload?.finish_card);
        const game = session.tableId ? [...games.values()].find((g) => g.tableId === session.tableId) : undefined;
        if (!game) { socket.emit('declare', { code: 404, message: 'Game not found' }); return; }
        const seat = session.seatNo ?? game.players.findIndex((u) => u === session.userId);
        if (seat < 0) { socket.emit('declare', { code: 404, message: 'Seat not found' }); return; }
        // Must be player's turn and they must have drawn a card this turn
        if (seat !== game.currentTurn || !game.drawnThisTurn[seat]) { socket.emit('declare', { code: 409, message: 'You must draw and it must be your turn to declare' }); return; }
        // Finish card must be in hand
        if (!finishCode || !game.playersHands[seat].includes(finishCode)) { socket.emit('declare', { code: 409, message: 'Select a finish card from your hand to declare' }); return; }
        // Open-card constraint applies to finish as well
        if (game.lastDrawnFrom[seat] === 'open' && game.lastDrawnCard[seat] === finishCode) {
          socket.emit('declare', { code: 409, message: 'Cannot finish with the card picked from open pile this turn' });
          return;
        }
        // Simulate finish discard: remove from hand and push to discard/finish
        const idx = game.playersHands[seat].indexOf(finishCode);
        if (idx >= 0) game.playersHands[seat].splice(idx, 1);
        game.discardPile.push(finishCode);
        game.lastDrawnCard[seat] = null;
        game.lastDrawnFrom[seat] = null;
        // Now validate full hand coverage using groups
        const result = serverValidateDeclare(groups, wildRank);
        // Ensure groups cover all remaining hand cards (strict declare)
        const used = new Set<string>();
        for (const g of groups) {
          for (const c of g) used.add(c);
        }
        const remainingHand = game.playersHands[seat];
        const allCovered = remainingHand.every((c) => used.has(c));
        if (!allCovered) {
          socket.emit('declare', { code: 409, message: 'All cards must be grouped to declare' });
          // Put finish card back to hand to avoid desync
          try {
            const j = game.discardPile.lastIndexOf(finishCode);
            if (j >= 0) game.discardPile.splice(j, 1);
            game.playersHands[seat].push(finishCode);
          } catch {}
          return;
        }
        // Always echo validation result to declarer
        socket.emit('declare', { code: 200, message: 'Success', result });
        // If invalid, treat as wrong show: penalize declarer with MAX_POINTS and award others accordingly
        if (!result?.valid) {
          const MAX_POINTS = Number(process.env.MAX_POINTS || 80);
          const declarerId = session.userId;
          const winnerUserId = game.players.find((u) => u && u !== declarerId) || declarerId;
          const points = game.players.map((uid, seat) => ({
            user_id: uid,
            seat,
            points: uid === declarerId ? MAX_POINTS : 0,
          }));
        const rakePercent = Math.max(0, Math.min(100, Number(process.env.RAKE_PERCENT || 0)));
        // Build round-end payload with hands/groups for summary
        const handsByUser: Record<string, string[]> = {};
        const groupsByUser: Record<string, string[][]> = {};
        try {
          for (let seat = 0; seat < game.players.length; seat++) {
            const uid = game.players[seat];
            if (!uid) continue;
            handsByUser[uid] = [...(game.playersHands[seat] || [])];
            groupsByUser[uid] = [...(game.playersGroups[seat] || [])];
          }
        } catch {}
          const summaryWrong = {
            code: 200,
            message: 'RoundEnd',
            game_id: game.id,
            table_id: game.tableId,
            winner_user_id: winnerUserId || declarerId,
            points,
            point_value: game.pointValue,
          wildCardRank: game.wildCardRank,
          hands: handsByUser,
          groups: groupsByUser,
          rake: rakePercent,
          } as const;
          nsp.to(TABLE_ROOM(game.tableId)).emit('round-end', summaryWrong);
        try { game.phase = 'completed' as any; } catch {}
          clearTurnTimer(game.id);
          // Persist + apply wallets if DB
          if (isDbConnected()) {
            const totalLoserPoints = points.filter(p => p.user_id !== winnerUserId).reduce((acc, p) => acc + (p.points || 0), 0);
          const grossWinnerAmount = totalLoserPoints * game.pointValue;
          const rakeAmount = Math.round((grossWinnerAmount * rakePercent) ) / 100;
          const netWinnerAmount = grossWinnerAmount - rakeAmount;
            const deltas = points.map((p) => ({
              ...p,
            delta: p.user_id === winnerUserId ? netWinnerAmount : -(p.points * game.pointValue),
            }));
            try {
              await RoundResultModel.create({
                tableId: game.tableId,
                gameId: game.id,
                pointValue: game.pointValue,
                winnerUserId: winnerUserId || declarerId,
                points: deltas,
              rake: rakePercent,
              });
            } catch {}
            await Promise.all(deltas.map(async (d) => {
              const delta = Number(d.delta || 0);
              if (!Number.isFinite(delta)) return;
              try {
                await UserModel.updateOne({ _id: d.user_id }, [{
                  $set: { wallet: { $toString: { $round: [{ $add: [{ $toDouble: '$wallet' }, delta] }, 2] } } }
                }]).exec();
                const updated = await UserModel.findById(d.user_id).select('wallet').lean().exec();
                await WalletLedgerModel.create({ userId: d.user_id, delta, reason: 'round_settlement', ref: game.id, balanceAfter: updated?.wallet });
                if (updated?.wallet != null) emitWalletUpdate(String(d.user_id), String(updated.wallet), 'round_settlement', game.id);
              } catch {}
            }));
            // Optionally record rake to a special ledger user if configured
            try {
              if (rakeAmount > 0 && process.env.RAKE_WALLET_USER_ID) {
                const rakeUserId = String(process.env.RAKE_WALLET_USER_ID);
                await UserModel.updateOne({ _id: rakeUserId }, [{ $set: { wallet: { $toString: { $round: [{ $add: [{ $toDouble: '$wallet' }, rakeAmount] }, 2] } } } }]).exec();
                const updated = await UserModel.findById(rakeUserId).select('wallet').lean().exec();
                await WalletLedgerModel.create({ userId: rakeUserId, delta: rakeAmount, reason: 'rake', ref: game.id, balanceAfter: updated?.wallet });
              }
            } catch {}
          }
          const tbl = waitingTables.get(game.tableId);
          if (tbl) { tbl.status = 'waiting'; tbl.players = Array(tbl.noOfPlayers).fill(''); }
          games.delete(game.id);
          return;
        }
        // If valid, conclude round and notify room
        // game retrieved above
        const winnerUserId = session.userId;
        const MAX_POINTS = Number(process.env.MAX_POINTS || 80);
        const FIRST_DROP = Number(process.env.FIRST_DROP || 20);
        const MIDDLE_DROP = Number(process.env.MIDDLE_DROP || 40);
        // Baseline scoring: winner 0. For others: if packed, drop penalties; else compute hand deadwood points, capped.
        const points = game.players.map((uid, seat) => {
          if (!uid) return { user_id: uid, seat, points: 0 };
          if (uid === winnerUserId) return { user_id: uid, seat, points: 0 };
          if (game.packed[seat]) {
            const p = game.hasPlayedAnyTurn[seat] ? MIDDLE_DROP : FIRST_DROP;
            return { user_id: uid, seat, points: Math.min(p, MAX_POINTS) };
          }
          const hand = game.playersHands[seat] || [];
          const { points: deadwood } = computeHandPoints(hand, groups, wildRank);
          return { user_id: uid, seat, points: Math.min(deadwood, MAX_POINTS) };
        });
        const rakePercent2 = Math.max(0, Math.min(100, Number(process.env.RAKE_PERCENT || 0)));
        const handsByUser2: Record<string, string[]> = {};
        const groupsByUser2: Record<string, string[][]> = {};
        try {
          for (let seat = 0; seat < game.players.length; seat++) {
            const uid = game.players[seat];
            if (!uid) continue;
            handsByUser2[uid] = [...(game.playersHands[seat] || [])];
            groupsByUser2[uid] = [...(game.playersGroups[seat] || [])];
          }
        } catch {}
        const summary = {
          code: 200,
          message: 'RoundEnd',
          game_id: game.id,
          table_id: game.tableId,
          winner_user_id: winnerUserId,
          points,
          point_value: game.pointValue,
          wildCardRank: game.wildCardRank,
          hands: handsByUser2,
          groups: groupsByUser2,
          rake: rakePercent2,
        } as const;
        nsp.to(TABLE_ROOM(game.tableId)).emit('round-end', summary);
        try { game.phase = 'completed' as any; } catch {}
        clearTurnTimer(game.id);
        // Persist summary if DB connected
        if (isDbConnected()) {
          const totalLoserPoints = points.filter(p => p.user_id !== winnerUserId).reduce((acc, p) => acc + (p.points || 0), 0);
          const grossWinnerAmount = totalLoserPoints * game.pointValue;
          const rakeAmount = Math.round((grossWinnerAmount * rakePercent2) ) / 100;
          const netWinnerAmount = grossWinnerAmount - rakeAmount;
          const deltas = points.map((p) => ({
            ...p,
            delta: p.user_id === winnerUserId ? netWinnerAmount : -(p.points * game.pointValue),
          }));
          try {
            await RoundResultModel.create({
              tableId: game.tableId,
              gameId: game.id,
              pointValue: game.pointValue,
              winnerUserId,
              points: deltas,
              rake: rakePercent2,
            });
          } catch {}
          // Apply wallet deltas atomically (wallet stored as string)
          await Promise.all(deltas.map(async (d) => {
            const delta = Number(d.delta || 0);
            if (!Number.isFinite(delta)) return;
            try {
              await UserModel.updateOne({ _id: d.user_id }, [{
                $set: {
                  wallet: {
                    $toString: { $round: [{ $add: [{ $toDouble: '$wallet' }, delta] }, 2] }
                  }
                }
              }]).exec();
              const updated = await UserModel.findById(d.user_id).select('wallet').lean().exec();
              await WalletLedgerModel.create({ userId: d.user_id, delta, reason: 'round_settlement', ref: game.id, balanceAfter: updated?.wallet });
              if (updated?.wallet != null) emitWalletUpdate(String(d.user_id), String(updated.wallet), 'round_settlement', game.id);
            } catch {}
          }));
          // Rake credit to a configured wallet user
          try {
            if (rakeAmount > 0 && process.env.RAKE_WALLET_USER_ID) {
              const rakeUserId = String(process.env.RAKE_WALLET_USER_ID);
              await UserModel.updateOne({ _id: rakeUserId }, [{ $set: { wallet: { $toString: { $round: [{ $add: [{ $toDouble: '$wallet' }, rakeAmount] }, 2] } } } }]).exec();
              const updated = await UserModel.findById(rakeUserId).select('wallet').lean().exec();
              await WalletLedgerModel.create({ userId: rakeUserId, delta: rakeAmount, reason: 'rake', ref: game.id, balanceAfter: updated?.wallet });
            }
          } catch {}
        }
        // Cleanup: reset table to waiting and clear game
        const tbl = waitingTables.get(game.tableId);
        if (tbl) {
          tbl.status = 'waiting';
          // Clear players to allow fresh matchmaking
          tbl.players = Array(tbl.noOfPlayers).fill('');
        }
        games.delete(game.id);
      } catch {
        socket.emit('declare', { code: 400, message: 'Invalid declare payload' });
      }
    });

    // leave-table: remove user from table room and update state
    socket.on('leave-table', (_payload) => {
      const session = findSessionBySocket(socket.id);
      if (!session || !session.tableId) return;
      const tableId = session.tableId;
      const table = waitingTables.get(tableId);
      const game = [...games.values()].find((g) => g.tableId === tableId);
      // If table exists and is waiting, clear player's seat
      if (table && table.status === 'waiting') {
        if (session.userId) {
          const idx = table.players.indexOf(session.userId);
          if (idx >= 0) table.players[idx] = '';
          // notify room about new count
          try {
            const joinedCount = table.players.filter(Boolean).length;
            nsp.to(TABLE_ROOM(table.id)).emit('table-joined', {
              code: 200,
              message: 'Player left',
              table_id: table.id,
              joined: joinedCount,
              total: table.noOfPlayers,
            });
          } catch {}
        }
      }
      // If game is ongoing, mark this user as packed
      if (game) {
        const seat = game.players.findIndex((u) => u === session.userId);
        if (seat >= 0) {
          game.packed[seat] = true;
          nsp.to(TABLE_ROOM(game.tableId)).emit('status', {
            code: 200,
            message: 'Packed',
            game_id: game.id,
            currentTurn: game.currentTurn,
            deckCount: game.deck.length,
            discardTop: game.discardPile[game.discardPile.length - 1] || null,
            seats: game.players,
            packed: game.packed,
          });
        }
      }
      socket.leave(TABLE_ROOM(tableId));
      session.tableId = undefined;
      session.seatNo = undefined;
      socket.emit('leave-table', { code: 200, message: 'Success' });
    });

    socket.on('disconnect', (reason) => {
      // eslint-disable-next-line no-console
      console.log(`[socket] disconnected: ${socket.id} reason=${reason}`);
      const s = sessions.get(socket.id);
      if (s) {
        userIdToSocket.delete(s.userId);
        // Reconnect grace: retain session mapping for a short period before packing
        const graceMs = Math.max(5000, Number(process.env.RECONNECT_GRACE_MS || 15000));
        const userId = s.userId;
        const tableId = s.tableId;
        const seatNo = s.seatNo;
        // Remove socket-bound session immediately
        sessions.delete(socket.id);
        if (tableId && seatNo != null) {
          setTimeout(() => {
            // If user reconnected, they'll have a new socket mapped; skip
            const stillDisconnected = ![...sessions.values()].some(sess => sess.userId === userId && sess.tableId === tableId);
            if (!stillDisconnected) return;
            const game = [...games.values()].find((g) => g.tableId === tableId);
            if (game && seatNo >= 0) {
              game.packed[seatNo] = true;
              io.of('/rummy').to(TABLE_ROOM(game.tableId)).emit('status', {
                code: 200,
                message: 'Packed',
                game_id: game.id,
                currentTurn: game.currentTurn,
                deckCount: game.deck.length,
                discardTop: game.discardPile[game.discardPile.length - 1] || null,
                seats: game.players,
                phase: game.phase,
              });
            }
          }, graceMs);
          return;
        }
      } else {
        sessions.delete(socket.id);
      }
    });
  });

  return nsp;
}


