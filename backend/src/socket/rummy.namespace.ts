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
import { RoundResultModel, UserModel, WalletLedgerModel, TableModel, GameModel, WalletHoldModel } from '../db';
import { usersById } from '../services/auth.routes';
import { validateDeclare as serverValidateDeclare, computeHandPoints } from './rules';
import { computeRoundDeltasByFormat } from './finance';
import { getTableSchema, joinTableSchema, statusSchema, groupCardsSchema, discardSchema, declareSchema, packGameSchema, getCardSchema, getDropCardSchema } from './schemas';
import { emitWalletUpdate } from './emitter';
import { persistTableSnapshot, persistGameSnapshot, deleteGameSnapshot } from './persist';
import { loadRulesConfig } from './rules.config';
import { computeReserveHold } from './finance';
import { createInitialDealsState, applyRoundToDealsState, isDealsMatchOver, getDealsWinnerByMinPoints } from './deals';
import { poolStateByTable, dealsStateByTable } from './format.state';
import { logSocket } from '../logger';
import { createInitialPoolState, applyRoundToPoolState } from './pool';
import { ErrorCodes } from '../errors';

export function rummyNamespace(io: Server) {
  // Redis adapter omitted by request (single-instance mode)
  const nsp = io.of('/rummy');
  const rules = loadRulesConfig();

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
  const recentIdempotency = new Map<string, Map<string, number>>(); // socketId -> (key -> lastTs)
  const IDEMPOTENCY_WINDOW_MS = Math.max(500, Number(process.env.IDEMPOTENCY_WINDOW_MS || 5000));
  const dealsMatches = new Map<string, { remaining: number; cumulative: Record<string, number> }>(); // tableId -> deals match state
  const poolMatches = new Map<string, { cumulative: Record<string, number>; eliminated: Set<string>; threshold: number }>(); // tableId -> pool match state
  const isTestEnv = ((process.env.NODE_ENV || '').toLowerCase() === 'test') || !!process.env.JEST_WORKER_ID;
  const disableTimers = isTestEnv && (process.env.TEST_DISABLE_TIMERS === '1');

  // Global cleanup to avoid open handles in tests
  const cleanupTimers = () => {
    try {
      botTimers.forEach((t) => { try { clearTimeout(t); } catch {} });
      turnTimers.forEach((t) => { try { clearTimeout(t); } catch {} });
      turnTickIntervals.forEach((t) => { try { clearInterval(t); } catch {} });
      botTimers.clear();
      turnTimers.clear();
      turnTickIntervals.clear();
    } catch {}
  };
  try {
    process.once('beforeExit', cleanupTimers);
    process.once('exit', cleanupTimers);
    process.once('SIGINT', cleanupTimers);
    process.once('SIGTERM', cleanupTimers);
  } catch {}

  function alreadyProcessed(socketId: string, key?: string): boolean {
    if (!key) return false;
    const now = Date.now();
    let map = recentIdempotency.get(socketId);
    if (!map) { map = new Map<string, number>(); recentIdempotency.set(socketId, map); }
    const last = map.get(key) || 0;
    if (now - last < IDEMPOTENCY_WINDOW_MS) return true;
    map.set(key, now);
    // prune stale entries
    for (const [k, ts] of map) {
      if (now - ts > IDEMPOTENCY_WINDOW_MS) map.delete(k);
    }
    // soft cap size by dropping oldest
    if (map.size > 200) {
      const entries = Array.from(map.entries()).sort((a, b) => a[1] - b[1]);
      const drop = map.size - 200;
      for (let i = 0; i < drop; i++) map.delete(entries[i][0]);
    }
    return false;
  }
  function isBot(userId: string | undefined) { return typeof userId === 'string' && userId?.startsWith('bot:'); }
  function scheduleBotTurn(gameId: string) {
    if (disableTimers) return;
    if (botTimers.has(gameId)) return;
    const botMoveMs = Math.max(100, Number(process.env.BOT_MOVE_MS || 200));
    const run = () => {
      const game = games.get(gameId);
      if (!game) return;
      const seat = game.currentTurn;
      const userId = game.players[seat] || '';
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
        table_id: game.tableId,
        seats: game.players,
        packed: game.packed,
        deckCount: game.deck.length,
        phase: game.phase,
        turnDeadline: game.turnDeadline ?? null,
      });
      // schedule next if next is also bot
      const nextUser = game.players[game.currentTurn];
      if (isBot(nextUser)) {
        const t = setTimeout(run, botMoveMs);
        try { if (isTestEnv && typeof (t as any).unref === 'function') (t as any).unref(); } catch {}
        botTimers.set(gameId, t);
      } else {
        botTimers.delete(gameId);
      }
    };
    const t = setTimeout(run, botMoveMs);
    try { if (isTestEnv && typeof (t as any).unref === 'function') (t as any).unref(); } catch {}
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
    if (disableTimers) return;
    clearTurnTimer(gameId);
    const game = games.get(gameId);
    if (!game) return;
    const turnMs = rules.turnMs; // strict per-turn time
    const deadline = Date.now() + turnMs;
    try { game.turnDeadline = deadline; } catch {}
    const serializePlayers = (g: any, winnerUserId?: string) => {
      try {
        const arr: Array<{ id: string; status: 'active' | 'packed' | 'winner' }> = [];
        for (let i = 0; i < g.players.length; i++) {
          const uid = g.players[i];
          if (!uid) continue;
          let status: 'active' | 'packed' | 'winner' = 'active';
          if (winnerUserId && String(uid) === String(winnerUserId)) status = 'winner';
          else if (g.packed?.[i]) status = 'packed';
          arr.push({ id: String(uid), status });
        }
        return arr;
      } catch { return []; }
    };
    // Notify clients whose turn started
    try {
      const pid = game.players[game.currentTurn];
      if (pid) {
        nsp.to(TABLE_ROOM(game.tableId)).emit('turnStarted', { playerId: pid, expiresAt: deadline, players: serializePlayers(game) });
      }
    } catch {}
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
          deadline,
          serverTs: Date.now(),
          game_id: g.id,
        });
        if (remainingMs <= 0) {
          // let the timeout handler advance turn; interval will be cleared there
        }
      }, 1000);
      turnTickIntervals.set(gameId, tick);
      // Emit an immediate tick so clients can display the countdown without waiting 1s
      try {
        const remainingMs0 = Math.max(0, deadline - Date.now());
        const remainingSeconds0 = Math.ceil(remainingMs0 / 1000);
        const g0 = games.get(gameId);
        if (g0) {
          io.of('/rummy').to(TABLE_ROOM(g0.tableId)).emit('turn-tick', {
            currentTurn: g0.currentTurn,
            remainingSeconds: remainingSeconds0,
            deadline,
            serverTs: Date.now(),
            game_id: g0.id,
          });
        }
      } catch {}
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
        table_id: g.tableId,
        currentTurn: g.currentTurn,
        deckCount: g.deck.length,
        discardTop: g.discardPile[g.discardPile.length - 1] || null,
        seats: g.players,
        phase: g.phase,
        turnDeadline: g.turnDeadline ?? null,
        players: (() => {
          try {
            return g.players.map((uid, i) => ({ id: String(uid), status: g.packed?.[i] ? 'packed' : 'active' as const }));
          } catch { return []; }
        })(),
      });
      // If only one active player remains, conclude round
      const activeSeats = g.players.map((uid, i) => ({ uid, i })).filter(p => p.uid && !g.packed[p.i]);
      if (activeSeats.length <= 1) {
        const winnerUserId = activeSeats[0]?.uid || g.players.find(u => !!u) || '';
        const tableMetaForEnd = waitingTables.get(g.tableId);
        const tableFormatForEnd = (tableMetaForEnd?.format || 'points');
        const isPointsFormatForEnd = tableFormatForEnd === 'points';
        const { deltas: points, rakePercent } = computeRoundDeltasByFormat(tableMetaForEnd as any, g.players, g.packed, g.playersHands, g.playersGroups, winnerUserId, g.wildCardRank, rules);
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
        try { await deleteGameSnapshot(g.id); await persistTableSnapshot(waitingTables.get(g.tableId)!); } catch {}
        clearTurnTimer(g.id);
        try {
        if (isDbConnected()) {
            const tableMeta = waitingTables.get(g.tableId);
            const isPointsFormat = (tableMeta?.format || 'points') === 'points';
            const holds: any[] = await WalletHoldModel.find({ tableId: g.tableId, active: true }).lean().exec() as any[];
            if (isPointsFormat) {
              for (const h of holds) {
                const amt = Number(h.amount || 0);
                if (!Number.isFinite(amt) || amt === 0) continue;
                try {
                  await WalletLedgerModel.create({ userId: String(h.userId), delta: amt, reason: 'hold_release', ref: g.id });
                  await UserModel.updateOne({ _id: h.userId }, [{ $set: { wallet: { $toString: { $round: [{ $add: [{ $toDouble: '$wallet' }, amt] }, 2] } } } }]).exec();
                  const updated: any = await UserModel.findById(h.userId).select('wallet').lean().exec();
                  if (updated?.wallet != null) emitWalletUpdate(String(h.userId), String(updated.wallet), 'hold_release', g.id);
                } catch {}
              }
              await WalletHoldModel.updateMany({ tableId: g.tableId, active: true }, { $set: { active: false } }).exec();
            }
          }
        } catch {}
        if (isDbConnected()) {
          const tableMeta = waitingTables.get(g.tableId);
          const isPointsFormat = (tableMeta?.format || 'points') === 'points';
          if (isPointsFormat) {
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
                const updated = await UserModel.findById(d.user_id).select('wallet').lean().exec() as any;
              await WalletLedgerModel.create({ userId: d.user_id, delta, reason: 'round_settlement', ref: g.id, balanceAfter: updated?.wallet });
              if (updated?.wallet != null) emitWalletUpdate(String(d.user_id), String(updated.wallet), 'round_settlement', g.id);
            } catch {}
          }));
          try {
            if (rakeAmount > 0 && process.env.RAKE_WALLET_USER_ID) {
              const rakeUserId = String(process.env.RAKE_WALLET_USER_ID);
              await UserModel.updateOne({ _id: rakeUserId }, [{ $set: { wallet: { $toString: { $round: [{ $add: [{ $toDouble: '$wallet' }, rakeAmount] }, 2] } } } }]).exec();
                const updated = await UserModel.findById(rakeUserId).select('wallet').lean().exec() as any;
              await WalletLedgerModel.create({ userId: rakeUserId, delta: rakeAmount, reason: 'rake', ref: g.id, balanceAfter: updated?.wallet });
            }
          } catch {}
          } else {
            try {
              await RoundResultModel.create({
                tableId: g.tableId,
                gameId: g.id,
                pointValue: g.pointValue,
                winnerUserId,
                points,
                rake: 0,
              });
            } catch {}
          }
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
      try { g.turnDeadline = Date.now() + rules.turnMs; } catch {}
      nsp.to(TABLE_ROOM(g.tableId)).emit('status', {
        code: 200,
        message: 'TurnTimeoutPacked',
        discardTop: g.discardPile[g.discardPile.length - 1] || null,
        currentTurn: g.currentTurn,
        game_id: g.id,
        table_id: g.tableId,
        seats: g.players,
          packed: g.packed,
        deckCount: g.deck.length,
        phase: g.phase,
        turnDeadline: g.turnDeadline ?? null,
      });
      if (isBot(g.players[g.currentTurn])) scheduleBotTurn(g.id);
      scheduleTurnTimer(g.id);
    }, turnMs);
    try { if (isTestEnv && typeof (t as any).unref === 'function') (t as any).unref(); } catch {}
    turnTimers.set(gameId, t);
  }

  nsp.on('connection', async (socket) => {
    // eslint-disable-next-line no-console
    logSocket('connected', { socketId: socket.id });

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
      const parsed = getTableSchema.safeParse(payload || {});
      if (!parsed.success) { socket.emit('get-table', { code: ErrorCodes.INVALID_REQUEST, message: 'Invalid request' }); return; }
      if (isRateLimited(socket.id, 'get-table', 500)) return;
      try {
      const session = findSessionBySocket(socket.id);
        if (!session) return;
      const { user_id, token: payloadToken, boot_value, no_of_players, format } = parsed.data;
      const tokenToCheck = String(payloadToken || session.token || '');
      const ok = await validateUserToken(String(user_id || session.userId), tokenToCheck);
        if (!ok) { socket.emit('get-table', { code: ErrorCodes.UNAUTHORIZED, message: 'Unauthorized' }); return; }
        // TODO: validate token for prod
        const table = createOrFindTable(String(boot_value ?? '0'), Number(no_of_players ?? 2), (format as any) || 'points');
        socket.join(TABLE_ROOM(table.id));
        session.tableId = table.id;
        try { await persistTableSnapshot(table); } catch {}
        socket.emit('get-table', {
          code: ErrorCodes.SUCCESS,
          message: 'Success',
          table_id: table.id,
          boot_value: table.bootValue,
          no_of_players: table.noOfPlayers,
        });
      } catch (e) {
        socket.emit('get-table', { code: ErrorCodes.SERVER_ERROR, message: 'error' });
      }
    });

    // join-table
    socket.on('join-table', async (payload) => {
      const parsed = joinTableSchema.safeParse(payload || {});
      if (alreadyProcessed(socket.id, parsed.success ? parsed.data.idempotencyKey : undefined)) return;
      if (!parsed.success) { socket.emit('join-table', { code: ErrorCodes.INVALID_REQUEST, message: 'Invalid request' }); return; }
      if (isRateLimited(socket.id, 'join-table', 500)) return;
      const session = findSessionBySocket(socket.id);
      if (!session) return;
      const { user_id, token: payloadToken, table_id } = parsed.data;
      const tokenToCheck = String(payloadToken || session.token || '');
      const ok = await validateUserToken(String(user_id || session.userId), tokenToCheck);
      if (!ok) { socket.emit('join-table', { code: ErrorCodes.UNAUTHORIZED, message: 'Unauthorized' }); return; }
      const table = waitingTables.get(String(table_id || session.tableId || ''));
      if (!table) {
        socket.emit('join-table', { code: ErrorCodes.NOT_FOUND, message: 'Table not found' });
        return;
      }
      // Wallet reserve check: require min(wallet) >= max(bootValue, MAX_POINTS*pointValue)
      try {
        const reserveMin = computeReserveHold(table, rules);
        let walletStr: string | undefined;
        if (isDbConnected()) {
          const dbUser = await UserModel.findById(user_id).select('wallet').lean().exec() as any;
          walletStr = (dbUser && (dbUser as any).wallet) as any;
        } else {
          const mem = usersById.get(String(user_id));
          walletStr = mem?.wallet;
        }
        const wallet = Number(walletStr || '0');
        if (!Number.isFinite(wallet) || wallet < reserveMin) {
          socket.emit('join-table', { code: ErrorCodes.INSUFFICIENT_WALLET, message: 'Insufficient wallet', required: reserveMin });
          return;
        }
        // Place a hold for this seat when DB is available
        try {
          if (isDbConnected()) {
            const existing = await WalletHoldModel.findOne({ userId: String(user_id), tableId: table.id, active: true }).lean().exec();
            if (!existing) {
              await WalletHoldModel.create({ userId: String(user_id), tableId: table.id, amount: reserveMin, reason: 'table_reserve', active: true });
              await WalletLedgerModel.create({ userId: String(user_id), delta: -reserveMin, reason: 'hold', ref: `hold:${table.id}` });
              await UserModel.updateOne({ _id: user_id }, [{ $set: { wallet: { $toString: { $round: [{ $add: [{ $toDouble: '$wallet' }, -reserveMin] }, 2] } } } }]).exec();
              const updated: any = await UserModel.findById(user_id).select('wallet').lean().exec();
              if (updated?.wallet != null) emitWalletUpdate(String(user_id), String(updated.wallet), 'hold', table.id);
            }
          }
        } catch {}
      } catch {}
      const joined = joinTable(table, String(user_id));
      if (!joined) {
        socket.emit('join-table', { code: ErrorCodes.CONFLICT, message: 'Table full' });
        return;
      }
      session.tableId = table.id;
      session.seatNo = joined.seatNo;
      socket.join(TABLE_ROOM(table.id));
      socket.emit('join-table', { code: ErrorCodes.SUCCESS, message: 'Success', table_id: table.id, seat_no: joined.seatNo });

      // Notify room about current player count
      const joinedCount = table.players.filter(Boolean).length;
      logSocket('table-joined', { tableId: table.id, joined: joinedCount, total: table.noOfPlayers });
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
        try { await persistTableSnapshot(table); await persistGameSnapshot(game); } catch {}
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
        logSocket('start-game', { tableId: table.id, gameId: game.id });
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
        // Show toss briefly, then send dealing status and hands (shorter in tests)
        const tossDelayMs = disableTimers ? 0 : (((process.env.NODE_ENV || '').toLowerCase() === 'test') ? 50 : 3000);
        const tossTimer = setTimeout(async () => {
          try {
            game.phase = 'dealing';
            nsp.to(TABLE_ROOM(table.id)).emit('status', {
              code: 200,
              message: 'Dealing',
              game_id: game.id,
              table_id: game.tableId,
              currentTurn: game.currentTurn,
              deckCount: game.deck.length,
              discardTop: game.discardPile[game.discardPile.length - 1] || null,
              seats: game.players,
              packed: game.packed,
              phase: game.phase,
              turnDeadline: game.turnDeadline ?? null,
              wildCardRank: game.wildCardRank || undefined,
              wildCardFace: (game as any).wildCardFace || undefined,
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
            // Seed a deadline for the first turn before broadcasting status
            try { game.turnDeadline = Date.now() + rules.turnMs; } catch {}
            // Immediately follow with a status update to avoid any clients clearing UI due to phase change
            nsp.to(TABLE_ROOM(table.id)).emit('status', {
              code: 200,
              message: 'Success',
              game_id: game.id,
              table_id: game.tableId,
              currentTurn: game.currentTurn,
              deckCount: game.deck.length,
              discardTop: game.discardPile[game.discardPile.length - 1] || null,
              seats: game.players,
              packed: game.packed,
              phase: game.phase,
              turnDeadline: game.turnDeadline ?? null,
              wildCardRank: game.wildCardRank || undefined,
              wildCardFace: (game as any).wildCardFace || undefined,
            });
            try { await persistGameSnapshot(game); } catch {}
            const firstTurnDelay = disableTimers ? 0 : 1000;
            setTimeout(() => {
              try {
                scheduleTurnTimer(game.id);
                if (isBot(game.players[game.currentTurn])) scheduleBotTurn(game.id);
              } catch {}
            }, firstTurnDelay);
          } catch {}
        }, tossDelayMs);
        try { if (isTestEnv && typeof (tossTimer as any).unref === 'function') (tossTimer as any).unref(); } catch {}
      }
    });

    // status
    socket.on('status', async (payload) => {
      const parsed = statusSchema.safeParse(payload || {});
      if (!parsed.success) { socket.emit('status', { code: ErrorCodes.INVALID_REQUEST, message: 'Invalid request' }); return; }
      if (isRateLimited(socket.id, 'status', 500)) return;
      const { game_id } = parsed.data;
      const session = findSessionBySocket(socket.id);
      if (session && (payload?.user_id || session.userId)) {
        const userToCheck = String(payload?.user_id || session.userId);
        const tokenToCheck = String(payload?.token || session.token || '');
        const ok = await validateUserToken(userToCheck, tokenToCheck);
        if (!ok) { socket.emit('status', { code: ErrorCodes.UNAUTHORIZED, message: 'Unauthorized' }); return; }
      }
      const game = games.get(String(game_id || ''));
      if (!game) {
        socket.emit('status', { code: ErrorCodes.NOT_FOUND, message: 'Game not found' });
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
        code: ErrorCodes.SUCCESS,
        message: 'Success',
        game_id: game.id,
        table_id: game.tableId,
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
        turnDeadline: game.turnDeadline ?? null,
        wildCardRank: (game as any).wildCardRank || undefined,
        wildCardFace: (game as any).wildCardFace || undefined,
      });
      try { await persistGameSnapshot(game); } catch {}
      // Proactively provide current hand only after toss phase to avoid early reveal
      try {
        if (game.phase !== 'toss') {
          const session2 = findSessionBySocket(socket.id);
          if (session2) {
            const seat2 = session2.seatNo ?? game.players.findIndex((u) => u === session2.userId);
            if (seat2 != null && seat2 >= 0 && Array.isArray(game.playersHands[seat2]) && game.playersHands[seat2].length > 0) {
              nsp.to(socket.id).emit('my-card', { code: ErrorCodes.SUCCESS, message: 'Success', hand: game.playersHands[seat2] });
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

    // TEST-ONLY: force a valid declare from the current user to conclude the round deterministically
    if (isTestEnv) {
      socket.on('test_force_declare', async () => {
        const session = findSessionBySocket(socket.id);
        if (!session) return;
        const game = session.tableId ? [...games.values()].find((g) => g.tableId === session.tableId) : undefined;
        if (!game) return;
        // Ensure it's winner's turn to avoid race with other timers
        const seat = game.players.findIndex((u) => u === session.userId);
        if (seat >= 0) game.currentTurn = seat;
        // Set winner as the caller; compute points and emit round-end
        const winnerUserId = session.userId;
        const { deltas: points, rakePercent } = computeRoundDeltasByFormat(waitingTables.get(game.tableId) as any, game.players, game.packed, game.playersHands, game.playersGroups, winnerUserId, game.wildCardRank, rules);
        const summary = {
          code: 200,
          message: 'RoundEnd',
          game_id: game.id,
          table_id: game.tableId,
          winner_user_id: winnerUserId,
          points,
          point_value: game.pointValue,
          rake: rakePercent,
        } as const;
        nsp.to(TABLE_ROOM(game.tableId)).emit('round-end', summary);
        clearTurnTimer(game.id);
        try { await deleteGameSnapshot(game.id); await persistTableSnapshot(waitingTables.get(game.tableId)!); } catch {}
        try {
          if (isDbConnected()) {
            const tableMeta = waitingTables.get(game.tableId);
            const isPointsFormat = (tableMeta?.format || 'points') === 'points';
            const holds: any[] = await WalletHoldModel.find({ tableId: game.tableId, active: true }).lean().exec() as any[];
            if (isPointsFormat) {
              for (const h of holds) {
                const amt = Number(h.amount || 0);
                if (!Number.isFinite(amt) || amt === 0) continue;
                try {
                  await WalletLedgerModel.create({ userId: String(h.userId), delta: amt, reason: 'hold_release', ref: game.id });
                  await UserModel.updateOne({ _id: h.userId }, [{ $set: { wallet: { $toString: { $round: [{ $add: [{ $toDouble: '$wallet' }, amt] }, 2] } } } }]).exec();
                  const updated: any = await UserModel.findById(h.userId).select('wallet').lean().exec();
                  if (updated?.wallet != null) emitWalletUpdate(String(h.userId), String(updated.wallet), 'hold_release', game.id);
                } catch {}
              }
              await WalletHoldModel.updateMany({ tableId: game.tableId, active: true }, { $set: { active: false } }).exec();
            }
          }
        } catch {}
        if (isDbConnected()) {
          const totalLoserPoints = points.filter(p => p.user_id !== winnerUserId).reduce((acc, p) => acc + (p.points || 0), 0);
          const grossWinnerAmount = totalLoserPoints * game.pointValue;
          const rakeAmount = Math.round((grossWinnerAmount * rakePercent)) / 100;
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
              const updated = await UserModel.findById(d.user_id).select('wallet').lean().exec() as any;
              await WalletLedgerModel.create({ userId: d.user_id, delta, reason: 'round_settlement', ref: game.id, balanceAfter: updated?.wallet });
              if (updated?.wallet != null) emitWalletUpdate(String(d.user_id), String(updated.wallet), 'round_settlement', game.id);
            } catch {}
          }));
          try {
            if (rakeAmount > 0 && process.env.RAKE_WALLET_USER_ID) {
              const rakeUserId = String(process.env.RAKE_WALLET_USER_ID);
              await UserModel.updateOne({ _id: rakeUserId }, [{ $set: { wallet: { $toString: { $round: [{ $add: [{ $toDouble: '$wallet' }, rakeAmount] }, 2] } } } }]).exec();
              const updated = await UserModel.findById(rakeUserId).select('wallet').lean().exec() as any;
              await WalletLedgerModel.create({ userId: rakeUserId, delta: rakeAmount, reason: 'rake', ref: game.id, balanceAfter: updated?.wallet });
            }
          } catch {}
        }
        const tbl = waitingTables.get(game.tableId);
        if (tbl) { tbl.status = 'waiting'; tbl.players = Array(tbl.noOfPlayers).fill(''); }
        games.delete(game.id);
      });
      // Deterministic Deals progress + settlement for tests
      socket.on('test_deals_progress', async (_payload, ack?: (res: any) => void) => {
        const session = findSessionBySocket(socket.id);
        if (!session) return;
        const game = session.tableId ? [...games.values()].find((g) => g.tableId === session.tableId) : undefined;
        const tableMeta = session.tableId ? waitingTables.get(session.tableId) : undefined;
        if (!game || !tableMeta) return;
        const winnerUserId = session.userId;
        const { deltas: points, rakePercent } = computeRoundDeltasByFormat(tableMeta as any, game.players, game.packed, game.playersHands, game.playersGroups, winnerUserId, game.wildCardRank, rules);
        const dealsCount = Math.max(1, Number(process.env.DEALS_COUNT || 1));
        const st0 = dealsMatches.get(game.tableId) || createInitialDealsState(dealsCount);
        const roundPoints = points.map(p => ({ user_id: p.user_id, points: p.points }));
        const st1 = applyRoundToDealsState(st0 as any, roundPoints as any, winnerUserId);
        dealsMatches.set(game.tableId, st1 as any);
        try { dealsStateByTable.set(game.tableId, st1 as any); } catch {}
        const payload = {
          code: 200,
          message: 'DealsProgress',
          table_id: game.tableId,
          remaining: st1.remaining,
          cumulative: st1.cumulative,
        } as const;
        nsp.to(TABLE_ROOM(game.tableId)).emit('deals-progress', payload);
        try { if (typeof ack === 'function') ack({ ok: true, ...payload }); } catch {}
        // Settle immediately when remaining hits 0
        if ((st1 as any).remaining <= 0) {
          const entries = Object.entries(st1.cumulative || {});
          const totalLoserPoints = entries.filter(([uid]) => uid !== winnerUserId).reduce((acc, [, pts]) => acc + (Number(pts) || 0), 0);
          const rakeAmount = Math.round((totalLoserPoints * game.pointValue * (rakePercent || 0))) / 100;
          const netWinnerAmount = totalLoserPoints * game.pointValue - rakeAmount;
          const finalDeltas = entries.map(([uid, pts]) => ({ user_id: uid, seat: game.players.indexOf(uid), points: Number(pts) || 0, delta: uid === winnerUserId ? netWinnerAmount : -((Number(pts) || 0) * game.pointValue) }));
          try { await RoundResultModel.create({ tableId: game.tableId, gameId: game.id, pointValue: game.pointValue, winnerUserId, points: finalDeltas, rake: rakePercent }); } catch {}
        }
      });
      // Deterministic Pool progress for tests
      socket.on('test_pool_progress', async (_payload, ack?: (res: any) => void) => {
        const session = findSessionBySocket(socket.id);
        if (!session) return;
        const game = session.tableId ? [...games.values()].find((g) => g.tableId === session.tableId) : undefined;
        const tableMeta = session.tableId ? waitingTables.get(session.tableId) : undefined;
        if (!game || !tableMeta) return;
        const winnerUserId = session.userId;
        const { deltas: points } = computeRoundDeltasByFormat(tableMeta as any, game.players, game.packed, game.playersHands, game.playersGroups, winnerUserId, game.wildCardRank, rules);
        const threshold = Math.max(1, Number(process.env.POOL_MAX_POINTS || 20));
        const st0 = poolMatches.get(game.tableId) || createInitialPoolState(threshold);
        const roundPoints = points.map(p => ({ user_id: p.user_id, points: p.user_id === winnerUserId ? 0 : rules.middleDrop }));
        const st1 = applyRoundToPoolState(st0 as any, roundPoints as any, winnerUserId);
        poolMatches.set(game.tableId, st1 as any);
        try { poolStateByTable.set(game.tableId, st1 as any); } catch {}
        const payload = {
          code: 200,
          message: 'PoolProgress',
          table_id: game.tableId,
          cumulative: st1.cumulative,
          eliminated: Array.from(st1.eliminated),
          threshold: st1.threshold,
        } as const;
        nsp.to(TABLE_ROOM(game.tableId)).emit('pool-progress', payload);
        try { if (typeof ack === 'function') ack({ ok: true, ...payload }); } catch {}
      });
    }

    // get-card: draw from deck to player hand, emit updated hand
    socket.on('get-card', async (payload) => {
      const parsed = getCardSchema.safeParse(payload || {});
      if (alreadyProcessed(socket.id, parsed.success ? parsed.data.idempotencyKey : undefined)) return;
      if (isRateLimited(socket.id, 'get-card', 800)) return;
      const session = findSessionBySocket(socket.id);
      if (!session || !session.tableId) return;
      // Enforce token when DB is connected
      try {
        if (isDbConnected()) {
          const ok = await validateUserToken(session.userId, session.token);
          if (!ok) { socket.emit('get-card', { code: ErrorCodes.UNAUTHORIZED, message: 'Unauthorized' }); return; }
        }
      } catch {}
      const game = [...games.values()].find((g) => g.tableId === session.tableId);
      if (!game) return;
      // Ensure it's the player's turn to draw
      const seat = session.seatNo ?? game.players.findIndex((u) => u === session.userId);
      if (seat !== game.currentTurn) { socket.emit('get-card', { code: ErrorCodes.CONFLICT, message: 'Not your turn' }); return; }
      if (game.drawnThisTurn[seat]) { socket.emit('get-card', { code: ErrorCodes.CONFLICT, message: 'Already drew a card this turn' }); return; }
      if (seat < 0 || game.packed[seat]) { socket.emit('get-card', { code: ErrorCodes.CONFLICT, message: 'Packed user cannot draw' }); return; }
      const card = game.deck.shift() || null;
      if (card && seat >= 0) {
        game.playersHands[seat].push(card);
        game.drawnThisTurn[seat] = true;
        game.hasPlayedAnyTurn[seat] = true;
        game.lastDrawnCard[seat] = card;
        game.lastDrawnFrom[seat] = 'closed';
      }
      socket.emit('get-card', { code: ErrorCodes.SUCCESS, message: 'Success', card, hand: seat >= 0 ? game.playersHands[seat] : [] });
      // Do NOT reset the turn timer on draw; a player has a total of 30s for the whole turn
    });

    // get-drop-card: peek top discard and give it
    socket.on('get-drop-card', async (payload) => {
      const parsed = getDropCardSchema.safeParse(payload || {});
      if (alreadyProcessed(socket.id, parsed.success ? parsed.data.idempotencyKey : undefined)) return;
      if (isRateLimited(socket.id, 'get-drop-card', 800)) return;
      const session = findSessionBySocket(socket.id);
      if (!session || !session.tableId) return;
      // Enforce token when DB is connected
      try {
        if (isDbConnected()) {
          const ok = await validateUserToken(session.userId, session.token);
          if (!ok) { socket.emit('get-drop-card', { code: ErrorCodes.UNAUTHORIZED, message: 'Unauthorized' }); return; }
        }
      } catch {}
      const game = [...games.values()].find((g) => g.tableId === session.tableId);
      if (!game) return;
      // Ensure it's the player's turn to draw from discard
      const seat = session.seatNo ?? game.players.findIndex((u) => u === session.userId);
      if (seat !== game.currentTurn) { socket.emit('get-drop-card', { code: ErrorCodes.CONFLICT, message: 'Not your turn' }); return; }
      if (game.drawnThisTurn[seat]) { socket.emit('get-drop-card', { code: ErrorCodes.CONFLICT, message: 'Already drew a card this turn' }); return; }
      if (seat < 0 || game.packed[seat]) { socket.emit('get-drop-card', { code: ErrorCodes.CONFLICT, message: 'Packed user cannot draw' }); return; }
      const card = game.discardPile.pop() || null;
      if (card && seat >= 0) {
        game.playersHands[seat].push(card);
        game.drawnThisTurn[seat] = true;
        game.lastDrawnCard[seat] = card;
        game.lastDrawnFrom[seat] = 'open';
      }
      socket.emit('get-drop-card', { code: ErrorCodes.SUCCESS, message: 'Success', card, hand: seat >= 0 ? game.playersHands[seat] : [] });
      // Do NOT reset the turn timer on draw; a player has a total of 30s for the whole turn
    });

    // discardCard: client sends full card object, server converts to code and discards
    socket.on('discardCard', async (payload) => {
      const parsed = discardSchema.safeParse(payload || {});
      if (alreadyProcessed(socket.id, parsed.success ? parsed.data.idempotencyKey : undefined)) return;
      if (!parsed.success) { socket.emit('status', { code: ErrorCodes.INVALID_REQUEST, message: 'Invalid request' }); return; }
      if (isRateLimited(socket.id, 'discardCard', 500)) return;
      const session = findSessionBySocket(socket.id);
      if (!session || !session.tableId) return;
      try {
        if (isDbConnected()) {
          const ok = await validateUserToken(session.userId, session.token);
          if (!ok) { socket.emit('discardCard', { code: ErrorCodes.UNAUTHORIZED, message: 'Unauthorized' }); return; }
        }
      } catch {}
      const game = [...games.values()].find((g) => g.tableId === session.tableId);
      if (!game) return;
      const seat = session.seatNo ?? game.players.findIndex((u) => u === session.userId);
      if (seat < 0 || game.packed[seat]) { socket.emit('status', { code: ErrorCodes.CONFLICT, message: 'Packed user cannot discard' }); return; }
      const code = clientCardToCode(parsed.data.card);
      if (!code || seat < 0) return;
      // Enforce draw-then-discard and turn ownership
      if (seat !== game.currentTurn || !game.drawnThisTurn[seat]) {
        socket.emit('status', { code: ErrorCodes.CONFLICT, message: 'Not your turn or you must draw before discarding' });
        return;
      }
      // Open-card constraint: cannot discard the same card drawn from open pile
      if (game.lastDrawnFrom[seat] === 'open' && game.lastDrawnCard[seat] === code) {
        socket.emit('status', { code: ErrorCodes.CONFLICT, message: 'Cannot discard the card picked from open pile this turn' });
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
      logSocket('status-discard', { tableId: game.tableId, gameId: game.id, seat });
      nsp.to(TABLE_ROOM(game.tableId)).emit('status', {
        code: 200,
        message: 'Discarded',
        discardTop: code,
        currentTurn: game.currentTurn,
        table_id: game.tableId,
        packed: game.packed,
        deckCount: game.deck.length,
        seats: game.players,
        phase: game.phase,
        turnDeadline: game.turnDeadline ?? null,
      });
      try { await persistGameSnapshot(game); } catch {}
      // If next is a bot, schedule
      if (isBot(game.players[game.currentTurn])) {
        scheduleBotTurn(game.id);
      }
      scheduleTurnTimer(game.id);
    });

    // group-cards: persist current player groups (UI arrangement), not used for validation mid-hand
    socket.on('group-cards', async (payload) => {
      const parsed = groupCardsSchema.safeParse(payload || {});
      if (alreadyProcessed(socket.id, parsed.success ? parsed.data.idempotencyKey : undefined)) return;
      if (!parsed.success) { socket.emit('group-cards', { code: ErrorCodes.INVALID_REQUEST, message: 'Invalid request' }); return; }
      if (isRateLimited(socket.id, 'group-cards', 500)) return;
      const session = findSessionBySocket(socket.id);
      if (!session || !session.tableId) return;
      try {
        if (isDbConnected()) {
          const ok = await validateUserToken(session.userId, session.token);
          if (!ok) { socket.emit('group-cards', { code: ErrorCodes.UNAUTHORIZED, message: 'Unauthorized' }); return; }
        }
      } catch {}
      const game = [...games.values()].find((g) => g.tableId === session.tableId);
      if (!game) return;
      const seat = session.seatNo ?? game.players.findIndex((u) => u === session.userId);
      if (seat < 0) return;
      if (game.packed[seat]) { socket.emit('group-cards', { code: ErrorCodes.CONFLICT, message: 'Packed user cannot group' }); return; }
      const groups = parsed.data.groups || [];
      // DEBUG
      try { console.log('[group-cards]', socket.id, 'groups:', groups.length, 'sample:', (groups[0] || []).slice(0,3)); } catch {}
      // Shallow validation: ensure codes belong to player's hand
      const handSet = new Set(game.playersHands[seat]);
      for (const group of groups) {
        if (!Array.isArray(group)) return;
        for (const code of group) {
          if (!handSet.has(code)) return;
        }
      }
      game.playersGroups[seat] = groups;
      // Immediately echo a status to the caller containing updated myGroups to keep client UI in sync, then also echo my-card
      try {
        socket.emit('status', {
          code: ErrorCodes.SUCCESS,
          message: 'GroupsUpdated',
          game_id: game.id,
          table_id: game.tableId,
          currentTurn: game.currentTurn,
          deckCount: game.deck.length,
          discardTop: game.discardPile[game.discardPile.length - 1] || null,
          seats: game.players,
          packed: game.packed,
          phase: game.phase,
          myGroups: game.playersGroups[seat] || [],
          turnDeadline: game.turnDeadline ?? null,
        });
        try { socket.emit('my-card', { code: ErrorCodes.SUCCESS, message: 'Success', hand: game.playersHands[seat] || [] }); } catch {}
        console.log('[group-cards] echoed status with myGroups', (game.playersGroups[seat] || []).length, 'handLen', (game.playersHands[seat] || []).length);
      } catch {}
      socket.emit('group-cards', { code: ErrorCodes.SUCCESS, message: 'Success' });
    });

    // pack-game: user packs
    socket.on('pack-game', async (payload) => {
      const parsed = packGameSchema.safeParse(payload || {});
      if (!parsed.success) { socket.emit('pack-game', { code: ErrorCodes.INVALID_REQUEST, message: 'Invalid request' }); return; }
      if (alreadyProcessed(socket.id, parsed.success ? parsed.data.idempotencyKey : undefined)) return;
      if (isRateLimited(socket.id, 'pack-game', 800)) return;
      const { game_id } = parsed.data || {};
      const game = games.get(String(game_id || ''));
      if (!game) {
        socket.emit('pack-game', { code: ErrorCodes.NOT_FOUND, message: 'Game not found' });
        return;
      }
      const session = findSessionBySocket(socket.id);
      if (!session) { socket.emit('pack-game', { code: ErrorCodes.UNAUTHORIZED, message: 'Unauthorized' }); return; }
      try {
        if (isDbConnected()) {
          const ok = await validateUserToken(session.userId, session.token);
          if (!ok) { socket.emit('pack-game', { code: ErrorCodes.UNAUTHORIZED, message: 'Unauthorized' }); return; }
        }
      } catch {}
      const seat = game.players.findIndex((u) => u === session.userId);
      if (seat < 0) { socket.emit('pack-game', { code: ErrorCodes.NOT_FOUND, message: 'Seat not found' }); return; }
      game.packed[seat] = true;
      // Broadcast status update
      logSocket('packed', { tableId: game.tableId, gameId: game.id, seat });
      nsp.to(TABLE_ROOM(game.tableId)).emit('status', {
        code: ErrorCodes.SUCCESS,
        message: 'Packed',
        game_id: game.id,
        table_id: game.tableId,
        currentTurn: game.currentTurn,
        deckCount: game.deck.length,
        discardTop: game.discardPile[game.discardPile.length - 1] || null,
        seats: game.players,
        packed: game.packed,
        phase: game.phase,
        turnDeadline: game.turnDeadline ?? null,
      });
      socket.emit('pack-game', { code: ErrorCodes.SUCCESS, message: 'Success' });
      try { await persistGameSnapshot(game); } catch {}
      // If only one active player remains, immediately conclude round
      const activeSeats = game.players.map((uid, i) => ({ uid, i })).filter(p => p.uid && !game.packed[p.i]);
      if (activeSeats.length <= 1) {
        const winnerUserId = activeSeats[0]?.uid || game.players.find(u => !!u) || '';
        const tableMetaForEnd = waitingTables.get(game.tableId);
        const { deltas: points, rakePercent } = computeRoundDeltasByFormat(tableMetaForEnd as any, game.players, game.packed, game.playersHands, game.playersGroups, winnerUserId, game.wildCardRank, rules);
        const summary = {
          code: 200,
          message: 'RoundEnd',
          game_id: game.id,
          table_id: game.tableId,
          winner_user_id: winnerUserId,
          points,
          point_value: game.pointValue,
          rake: rakePercent,
        } as const;
        logSocket('round-end', { tableId: game.tableId, gameId: game.id, winnerUserId });
        nsp.to(TABLE_ROOM(game.tableId)).emit('round-end', summary);
        // DEALS/POOL PROGRESSION (emit progress snapshot; settle Deals at match end)
        try {
          const tableMeta = waitingTables.get(game.tableId);
          const fmt = (tableMeta?.format || 'points');
          const isPoolFormat = fmt === 'pool';
          if (isPoolFormat) {
            const threshold = Math.max(1, Number(process.env.POOL_MAX_POINTS || 101));
            const st0 = poolMatches.get(game.tableId) || createInitialPoolState(threshold);
            const roundPoints = points.map(p => ({ user_id: p.user_id, points: p.points }));
            const st1 = applyRoundToPoolState(st0 as any, roundPoints as any, winnerUserId);
            poolMatches.set(game.tableId, st1 as any);
            poolStateByTable.set(game.tableId, st1 as any);
            nsp.to(TABLE_ROOM(game.tableId)).emit('pool-progress', {
              code: ErrorCodes.SUCCESS,
              message: 'PoolProgress',
              table_id: game.tableId,
              cumulative: st1.cumulative,
              eliminated: Array.from(st1.eliminated),
              threshold: st1.threshold,
            });
            // Chain to next round or finalize if one remains
            const allPlayers = game.players.filter(Boolean);
            const remaining = allPlayers.filter(uid => !st1.eliminated.has(uid));
            if (remaining.length > 1) {
              const tbl2 = waitingTables.get(game.tableId);
              if (tbl2) {
                for (let i = 0; i < tbl2.players.length; i++) {
                  const uid = tbl2.players[i];
                  if (uid && st1.eliminated.has(uid)) tbl2.players[i] = '';
                }
                tbl2.status = 'waiting';
                games.delete(game.id);
                const next = startGameForTable(tbl2);
                try { await persistTableSnapshot(tbl2); await persistGameSnapshot(next); } catch {}
                try {
                  for (let i = 0; i < next.players.length; i++) {
                    const uid = next.players[i];
                    if (!uid) continue;
                    const sid = userIdToSocket.get(uid);
                    if (!sid) continue;
                    const sess = sessions.get(sid);
                    if (sess) sess.seatNo = i;
                  }
                } catch {}
                try {
                  next.phase = 'toss';
                  nsp.to(TABLE_ROOM(tbl2.id)).emit('start-game', {
                    code: 200,
                    message: 'Success',
                    game_id: next.id,
                    table_id: tbl2.id,
                    wildCardRank: next.wildCardRank,
                    currentTurn: next.currentTurn,
                    seats: next.players,
                    toss: { winnerSeat: next.toss?.winnerSeat, winnerUserId: next.toss?.winnerUserId, cardsByUser: next.toss?.cardsByUser },
                    phase: next.phase,
                  });
                } catch {}
                const ndTimer = setTimeout(async () => {
                  try {
                    next.phase = 'dealing';
                    nsp.to(TABLE_ROOM(tbl2.id)).emit('status', {
                      code: 200,
                      message: 'Dealing',
                      game_id: next.id,
                      table_id: next.tableId,
                      currentTurn: next.currentTurn,
                      deckCount: next.deck.length,
                      discardTop: next.discardPile[next.discardPile.length - 1] || null,
                      seats: next.players,
                      packed: next.packed,
                      phase: next.phase,
                      turnDeadline: next.turnDeadline ?? null,
                    });
                    for (let seat = 0; seat < next.players.length; seat++) {
                      const uid = next.players[seat];
                      if (!uid) continue;
                      const sid = userIdToSocket.get(uid);
                      if (!sid) continue;
                      nsp.to(sid).emit('my-card', { code: 200, message: 'Success', hand: next.playersHands[seat] || [] });
                    }
                    next.phase = 'started';
                    try { next.turnDeadline = Date.now() + rules.turnMs; } catch {}
                    nsp.to(TABLE_ROOM(tbl2.id)).emit('status', {
                      code: 200,
                      message: 'Success',
                      game_id: next.id,
                      table_id: next.tableId,
                      currentTurn: next.currentTurn,
                      deckCount: next.deck.length,
                      discardTop: next.discardPile[next.discardPile.length - 1] || null,
                      seats: next.players,
                      packed: next.packed,
                      phase: next.phase,
                      turnDeadline: next.turnDeadline ?? null,
                    });
                    try { await persistGameSnapshot(next); } catch {}
                    scheduleTurnTimer(next.id);
                    if (isBot(next.players[next.currentTurn])) scheduleBotTurn(next.id);
                  } catch {}
                }, disableTimers ? 0 : 3000);
                try { if (isTestEnv && typeof (ndTimer as any).unref === 'function') (ndTimer as any).unref(); } catch {}
                return;
              }
            } else {
              // Finalize pool settlement
              const entries = Object.entries(st1.cumulative);
              const finalWinner = remaining[0] || winnerUserId;
              const pointValue = game.pointValue;
              const totalLoserPoints = entries.filter(([uid]) => uid !== finalWinner).reduce((acc, [, pts]) => acc + (Number(pts) || 0), 0);
              const rakeAmount = Math.round((totalLoserPoints * pointValue * (rules.rakePercent || 0))) / 100;
              const netWinnerAmount = totalLoserPoints * pointValue - rakeAmount;
              const finalDeltas = entries.map(([uid, pts]) => ({ user_id: uid, seat: game.players.indexOf(uid), points: Number(pts) || 0, delta: uid === finalWinner ? netWinnerAmount : -((Number(pts) || 0) * pointValue) }));
              try {
                if (isDbConnected()) {
                  const holds: any[] = await WalletHoldModel.find({ tableId: game.tableId, active: true }).lean().exec() as any[];
                  for (const h of holds) {
                    const amt = Number(h.amount || 0);
                    if (!Number.isFinite(amt) || amt === 0) continue;
                    try {
                      await WalletLedgerModel.create({ userId: String(h.userId), delta: amt, reason: 'hold_release', ref: game.id });
                      await UserModel.updateOne({ _id: h.userId }, [{ $set: { wallet: { $toString: { $round: [{ $add: [{ $toDouble: '$wallet' }, amt] }, 2] } } } }]).exec();
                      const updated: any = await UserModel.findById(h.userId).select('wallet').lean().exec();
                      if (updated?.wallet != null) emitWalletUpdate(String(h.userId), String(updated.wallet), 'hold_release', game.id);
                    } catch {}
                  }
                  await WalletHoldModel.updateMany({ tableId: game.tableId, active: true }, { $set: { active: false } }).exec();
                }
              } catch {}
              if (isDbConnected()) {
                try {
                  await RoundResultModel.create({ tableId: game.tableId, gameId: game.id, pointValue: pointValue, winnerUserId: finalWinner, points: finalDeltas, rake: rules.rakePercent });
                } catch {}
                await Promise.all(finalDeltas.map(async (d) => {
                  const delta = Number(d.delta || 0);
                  if (!Number.isFinite(delta)) return;
                  try {
                    await UserModel.updateOne({ _id: d.user_id }, [{ $set: { wallet: { $toString: { $round: [{ $add: [{ $toDouble: '$wallet' }, delta] }, 2] } } } }]).exec();
                    const updated = await UserModel.findById(d.user_id).select('wallet').lean().exec() as any;
                    await WalletLedgerModel.create({ userId: d.user_id, delta, reason: 'round_settlement', ref: game.id, balanceAfter: updated?.wallet });
                    if (updated?.wallet != null) emitWalletUpdate(String(d.user_id), String(updated.wallet), 'round_settlement', game.id);
                  } catch {}
                }));
                try {
                  if (rakeAmount > 0 && process.env.RAKE_WALLET_USER_ID) {
                    const rakeUserId = String(process.env.RAKE_WALLET_USER_ID);
                    await UserModel.updateOne({ _id: rakeUserId }, [{ $set: { wallet: { $toString: { $round: [{ $add: [{ $toDouble: '$wallet' }, rakeAmount] }, 2] } } } }]).exec();
                    const updated = await UserModel.findById(rakeUserId).select('wallet').lean().exec() as any;
                    await WalletLedgerModel.create({ userId: rakeUserId, delta: rakeAmount, reason: 'rake', ref: game.id, balanceAfter: updated?.wallet });
                  }
                } catch {}
              }
              poolMatches.delete(game.tableId);
              const tbl3 = waitingTables.get(game.tableId);
              if (tbl3) { tbl3.status = 'waiting'; tbl3.players = Array(tbl3.noOfPlayers).fill(''); }
              games.delete(game.id);
              return;
            }
          } else if (fmt === 'deals') {
            const dealsCount = Math.max(1, Number(process.env.DEALS_COUNT || 2));
            const st0 = dealsMatches.get(game.tableId) || createInitialDealsState(dealsCount);
            const roundPoints = points.map(p => ({ user_id: p.user_id, points: p.points }));
            const st1 = applyRoundToDealsState(st0 as any, roundPoints as any, winnerUserId);
            dealsMatches.set(game.tableId, st1 as any);
            dealsStateByTable.set(game.tableId, st1 as any);
            nsp.to(TABLE_ROOM(game.tableId)).emit('deals-progress', {
              code: 200,
              message: 'DealsProgress',
              table_id: game.tableId,
              remaining: st1.remaining,
              cumulative: st1.cumulative,
            });
            // Final settlement at match end
            if (isDealsMatchOver(st1 as any)) {
              const finalWinner = getDealsWinnerByMinPoints(st1 as any) || winnerUserId;
              const entries = Object.entries(st1.cumulative || {});
              const totalLoserPoints = entries.filter(([uid]) => uid !== finalWinner).reduce((acc, [, pts]) => acc + (Number(pts) || 0), 0);
              const rakeAmount = Math.round((totalLoserPoints * game.pointValue * (rules.rakePercent || 0))) / 100;
              const netWinnerAmount = totalLoserPoints * game.pointValue - rakeAmount;
              const finalDeltas = entries.map(([uid, pts]) => ({ user_id: uid, seat: game.players.indexOf(uid), points: Number(pts) || 0, delta: uid === finalWinner ? netWinnerAmount : -((Number(pts) || 0) * game.pointValue) }));
              // Release holds and apply wallet settlements
              try {
                if (isDbConnected()) {
                  const holds: any[] = await WalletHoldModel.find({ tableId: game.tableId, active: true }).lean().exec() as any[];
                  for (const h of holds) {
                    const amt = Number(h.amount || 0);
                    if (!Number.isFinite(amt) || amt === 0) continue;
                    try {
                      await WalletLedgerModel.create({ userId: String(h.userId), delta: amt, reason: 'hold_release', ref: game.id });
                      await UserModel.updateOne({ _id: h.userId }, [{ $set: { wallet: { $toString: { $round: [{ $add: [{ $toDouble: '$wallet' }, amt] }, 2] } } } }]).exec();
                      const updated: any = await UserModel.findById(h.userId).select('wallet').lean().exec();
                      if (updated?.wallet != null) emitWalletUpdate(String(h.userId), String(updated.wallet), 'hold_release', game.id);
                    } catch {}
                  }
                  await WalletHoldModel.updateMany({ tableId: game.tableId, active: true }, { $set: { active: false } }).exec();
                }
              } catch {}
              if (isDbConnected()) {
                try {
                  await RoundResultModel.create({ tableId: game.tableId, gameId: game.id, pointValue: game.pointValue, winnerUserId: finalWinner, points: finalDeltas, rake: rules.rakePercent });
                } catch {}
                await Promise.all(finalDeltas.map(async (d) => {
                  const delta = Number(d.delta || 0);
                  if (!Number.isFinite(delta)) return;
                  try {
                    await UserModel.updateOne({ _id: d.user_id }, [{ $set: { wallet: { $toString: { $round: [{ $add: [{ $toDouble: '$wallet' }, delta] }, 2] } } } }]).exec();
                    const updated = await UserModel.findById(d.user_id).select('wallet').lean().exec() as any;
                    await WalletLedgerModel.create({ userId: d.user_id, delta, reason: 'round_settlement', ref: game.id, balanceAfter: updated?.wallet });
                    if (updated?.wallet != null) emitWalletUpdate(String(d.user_id), String(updated.wallet), 'round_settlement', game.id);
                  } catch {}
                }));
                try {
                  if (rakeAmount > 0 && process.env.RAKE_WALLET_USER_ID) {
                    const rakeUserId = String(process.env.RAKE_WALLET_USER_ID);
                    await UserModel.updateOne({ _id: rakeUserId }, [{ $set: { wallet: { $toString: { $round: [{ $add: [{ $toDouble: '$wallet' }, rakeAmount] }, 2] } } } }]).exec();
                    const updated = await UserModel.findById(rakeUserId).select('wallet').lean().exec() as any;
                    await WalletLedgerModel.create({ userId: rakeUserId, delta: rakeAmount, reason: 'rake', ref: game.id, balanceAfter: updated?.wallet });
                  }
                } catch {}
              }
              dealsMatches.delete(game.tableId);
              const tblDone = waitingTables.get(game.tableId);
              if (tblDone) { tblDone.status = 'waiting'; tblDone.players = Array(tblDone.noOfPlayers).fill(''); }
              games.delete(game.id);
              return;
            }
          }
        } catch {}
        clearTurnTimer(game.id);
        try { await deleteGameSnapshot(game.id); await persistTableSnapshot(waitingTables.get(game.tableId)!); } catch {}
        try {
          if (isDbConnected()) {
            const tableMeta = waitingTables.get(game.tableId);
            const isPointsFormat = (tableMeta?.format || 'points') === 'points';
            const holds: any[] = await WalletHoldModel.find({ tableId: game.tableId, active: true }).lean().exec() as any[];
            if (isPointsFormat) {
              for (const h of holds) {
                const amt = Number(h.amount || 0);
                if (!Number.isFinite(amt) || amt === 0) continue;
                try {
                  await WalletLedgerModel.create({ userId: String(h.userId), delta: amt, reason: 'hold_release', ref: game.id });
                  await UserModel.updateOne({ _id: h.userId }, [{ $set: { wallet: { $toString: { $round: [{ $add: [{ $toDouble: '$wallet' }, amt] }, 2] } } } }]).exec();
                  const updated: any = await UserModel.findById(h.userId).select('wallet').lean().exec();
                  if (updated?.wallet != null) emitWalletUpdate(String(h.userId), String(updated.wallet), 'hold_release', game.id);
                } catch {}
              }
              await WalletHoldModel.updateMany({ tableId: game.tableId, active: true }, { $set: { active: false } }).exec();
            }
          }
        } catch {}
        if (isDbConnected()) {
          const tableMeta = waitingTables.get(game.tableId);
          const isPointsFormat = (tableMeta?.format || 'points') === 'points';
          if (isPointsFormat) {
            const totalLoserPoints = points.filter(p => p.user_id !== winnerUserId).reduce((acc, p) => acc + (p.points || 0), 0);
            const grossWinnerAmount = totalLoserPoints * game.pointValue;
            const rakeAmount = Math.round((grossWinnerAmount * rakePercent)) / 100;
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
                const updated = await UserModel.findById(d.user_id).select('wallet').lean().exec() as any;
                await WalletLedgerModel.create({ userId: d.user_id, delta, reason: 'round_settlement', ref: game.id, balanceAfter: updated?.wallet });
                if (updated?.wallet != null) emitWalletUpdate(String(d.user_id), String(updated.wallet), 'round_settlement', game.id);
              } catch {}
            }));
            try {
              if (rakeAmount > 0 && process.env.RAKE_WALLET_USER_ID) {
                const rakeUserId = String(process.env.RAKE_WALLET_USER_ID);
                await UserModel.updateOne({ _id: rakeUserId }, [{ $set: { wallet: { $toString: { $round: [{ $add: [{ $toDouble: '$wallet' }, rakeAmount] }, 2] } } } }]).exec();
                const updated = await UserModel.findById(rakeUserId).select('wallet').lean().exec() as any;
                await WalletLedgerModel.create({ userId: rakeUserId, delta: rakeAmount, reason: 'rake', ref: game.id, balanceAfter: updated?.wallet });
              }
            } catch {}
          } else {
            try {
              await RoundResultModel.create({
                tableId: game.tableId,
                gameId: game.id,
                pointValue: game.pointValue,
                winnerUserId,
                points,
                rake: 0,
              });
            } catch {}
          }
        }
        const tbl = waitingTables.get(game.tableId);
        if (tbl) { tbl.status = 'waiting'; tbl.players = Array(tbl.noOfPlayers).fill(''); }
        games.delete(game.id);
        return;
      }
      scheduleTurnTimer(game.id);
    });

    // Client-driven pack (timeout or manual from client): packPlayer { gameId?, playerId? }
    socket.on('packPlayer', async (payload) => {
      try {
        const session = findSessionBySocket(socket.id);
        if (!session) return;
        const game = payload?.gameId ? games.get(String(payload.gameId)) : (session.tableId ? [...games.values()].find((g) => g.tableId === session.tableId) : undefined);
        if (!game) return;
        const pid = String(payload?.playerId || '');
        const seat = pid ? game.players.findIndex((u) => String(u) === pid) : game.players.findIndex((u) => String(u) === String(session.userId));
        if (seat < 0) return;
        game.packed[seat] = true;
        // Broadcast player packed
        try {
          const serializePlayers = (g: any, winnerUserId?: string) => {
            try {
              const arr: Array<{ id: string; status: 'active' | 'packed' | 'winner' }> = [];
              for (let i = 0; i < g.players.length; i++) {
                const uid = g.players[i];
                if (!uid) continue;
                let status: 'active' | 'packed' | 'winner' = 'active';
                if (winnerUserId && String(uid) === String(winnerUserId)) status = 'winner';
                else if (g.packed?.[i]) status = 'packed';
                arr.push({ id: String(uid), status });
              }
              return arr;
            } catch { return []; }
          };
          nsp.to(TABLE_ROOM(game.tableId)).emit('playerPacked', { playerId: game.players[seat], seat, players: serializePlayers(game) });
        } catch {}
        // If only one active player remains, end game immediately
        const active = game.players.filter((u, i) => !!u && !game.packed[i]);
        if (active.length <= 1) {
          const winnerUserId = active[0] || game.players.find(u => !!u) || '';
          try {
            const serializePlayers = (g: any, winner?: string) => {
              try {
                const arr: Array<{ id: string; status: 'active' | 'packed' | 'winner' }> = [];
                for (let i = 0; i < g.players.length; i++) {
                  const uid = g.players[i];
                  if (!uid) continue;
                  let status: 'active' | 'packed' | 'winner' = 'active';
                  if (winner && String(uid) === String(winner)) status = 'winner';
                  else if (g.packed?.[i]) status = 'packed';
                  arr.push({ id: String(uid), status });
                }
                return arr;
              } catch { return []; }
            };
            nsp.to(TABLE_ROOM(game.tableId)).emit('gameOver', { game_id: game.id, table_id: game.tableId, winnerUserId, players: serializePlayers(game, winnerUserId) });
          } catch {}
          clearTurnTimer(game.id);
          games.delete(game.id);
          return;
        }
        // Shift turn to the next active player
        let next = (game.currentTurn + 1) % game.players.length;
        for (let i = 0; i < game.players.length; i++) {
          const idx = (game.currentTurn + 1 + i) % game.players.length;
          const uid = game.players[idx];
          if (uid && !game.packed[idx]) { next = idx; break; }
        }
        game.currentTurn = next;
        scheduleTurnTimer(game.id);
      } catch {}
    });

    // declare: validate groups; if valid, end round and broadcast a summary
    socket.on('declare', async (payload) => {
      const parsed = declareSchema.safeParse(payload || {});
      if (alreadyProcessed(socket.id, parsed.success ? parsed.data.idempotencyKey : undefined)) return;
      if (!parsed.success) { socket.emit('declare', { code: ErrorCodes.INVALID_REQUEST, message: 'Invalid request' }); return; }
      if (isRateLimited(socket.id, 'declare', 1000)) return;
      try {
        const session = findSessionBySocket(socket.id);
        if (!session) { socket.emit('declare', { code: ErrorCodes.UNAUTHORIZED, message: 'Unauthorized' }); return; }
        try {
          if (isDbConnected()) {
            const ok = await validateUserToken(session.userId, session.token);
            if (!ok) { socket.emit('declare', { code: ErrorCodes.UNAUTHORIZED, message: 'Unauthorized' }); return; }
          }
        } catch {}
        // Validate against wild rank from game
        const gameForDeclare = session.tableId ? [...games.values()].find(g => g.tableId === session.tableId) : undefined;
        const wildRank = gameForDeclare?.wildCardRank;
        if (gameForDeclare) {
          const seat = gameForDeclare.players.findIndex((u) => u === session.userId);
          if (seat >= 0 && gameForDeclare.packed[seat]) { socket.emit('declare', { code: ErrorCodes.CONFLICT, message: 'Packed user cannot declare' }); return; }
        }
        const groups = parsed.data.groups || [];
        // Require a finish card for declaration (discard to finish slot)
        const finishCode = clientCardToCode(parsed.data.finish_card);
        const game = session.tableId ? [...games.values()].find((g) => g.tableId === session.tableId) : undefined;
        if (!game) { socket.emit('declare', { code: ErrorCodes.NOT_FOUND, message: 'Game not found' }); return; }
        const seat = session.seatNo ?? game.players.findIndex((u) => u === session.userId);
        if (seat < 0) { socket.emit('declare', { code: ErrorCodes.NOT_FOUND, message: 'Seat not found' }); return; }
        // Must be player's turn and they must have drawn a card this turn
        if (seat !== game.currentTurn || !game.drawnThisTurn[seat]) { socket.emit('declare', { code: ErrorCodes.CONFLICT, message: 'You must draw and it must be your turn to declare' }); return; }
        // Finish card must be in hand
        if (!finishCode || !game.playersHands[seat].includes(finishCode)) { socket.emit('declare', { code: ErrorCodes.CONFLICT, message: 'Select a finish card from your hand to declare' }); return; }
        // Open-card constraint applies to finish as well
        if (game.lastDrawnFrom[seat] === 'open' && game.lastDrawnCard[seat] === finishCode) {
          socket.emit('declare', { code: ErrorCodes.CONFLICT, message: 'Cannot finish with the card picked from open pile this turn' });
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
        // Ensure groups cover all remaining hand cards (strict declare), unless relaxed via TEST_LOOSE_DECLARE
        const relaxCoverage = (process.env.TEST_LOOSE_DECLARE ?? '0') === '1';
        if (!relaxCoverage) {
        const used = new Set<string>();
        for (const g of groups) {
          for (const c of g) used.add(c);
        }
        const remainingHand = game.playersHands[seat];
        const allCovered = remainingHand.every((c) => used.has(c));
        if (!allCovered) {
            socket.emit('declare', { code: ErrorCodes.CONFLICT, message: 'All cards must be grouped to declare' });
          // Put finish card back to hand to avoid desync
          try {
            const j = game.discardPile.lastIndexOf(finishCode);
            if (j >= 0) game.discardPile.splice(j, 1);
            game.playersHands[seat].push(finishCode);
          } catch {}
          return;
          }
        }
        // Always echo validation result to declarer
        socket.emit('declare', { code: ErrorCodes.SUCCESS, message: 'Success', result });
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
           try { await deleteGameSnapshot(game.id); await persistTableSnapshot(waitingTables.get(game.tableId)!); } catch {}
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
                  const updated: any = await UserModel.findById(d.user_id).select('wallet').lean().exec();
                  await WalletLedgerModel.create({ userId: d.user_id, delta, reason: 'round_settlement', ref: game.id, balanceAfter: (updated as any)?.wallet });
                  if ((updated as any)?.wallet != null) emitWalletUpdate(String(d.user_id), String((updated as any).wallet), 'round_settlement', game.id);
              } catch {}
            }));
            // Optionally record rake to a special ledger user if configured
            try {
              if (rakeAmount > 0 && process.env.RAKE_WALLET_USER_ID) {
                const rakeUserId = String(process.env.RAKE_WALLET_USER_ID);
                await UserModel.updateOne({ _id: rakeUserId }, [{ $set: { wallet: { $toString: { $round: [{ $add: [{ $toDouble: '$wallet' }, rakeAmount] }, 2] } } } }]).exec();
                  const updated: any = await UserModel.findById(rakeUserId).select('wallet').lean().exec();
                  await WalletLedgerModel.create({ userId: rakeUserId, delta: rakeAmount, reason: 'rake', ref: game.id, balanceAfter: (updated as any)?.wallet });
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
        const { deltas: points, rakePercent: rakePercent2 } = computeRoundDeltasByFormat(waitingTables.get(game.tableId) as any, game.players, game.packed, game.playersHands, game.playersGroups, winnerUserId, wildRank, rules);
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
        try { await deleteGameSnapshot(game.id); await persistTableSnapshot(waitingTables.get(game.tableId)!); } catch {}
        try {
          if (isDbConnected()) {
            const tableMeta = waitingTables.get(game.tableId);
            const isPool = (tableMeta?.format || 'points') === 'pool';
            const holds: any[] = await WalletHoldModel.find({ tableId: game.tableId, active: true }).lean().exec() as any[];
            if (!isPool) {
              for (const h of holds) {
                const amt = Number(h.amount || 0);
                if (!Number.isFinite(amt) || amt === 0) continue;
                try {
                  await WalletLedgerModel.create({ userId: String(h.userId), delta: amt, reason: 'hold_release', ref: game.id });
                  await UserModel.updateOne({ _id: h.userId }, [{ $set: { wallet: { $toString: { $round: [{ $add: [{ $toDouble: '$wallet' }, amt] }, 2] } } } }]).exec();
                  const updated: any = await UserModel.findById(h.userId).select('wallet').lean().exec();
                  if (updated?.wallet != null) emitWalletUpdate(String(h.userId), String(updated.wallet), 'hold_release', game.id);
                } catch {}
              }
              await WalletHoldModel.updateMany({ tableId: game.tableId, active: true }, { $set: { active: false } }).exec();
            }
          }
        } catch {}
        try { if (isDbConnected()) await WalletHoldModel.updateMany({ tableId: game.tableId, active: true }, { $set: { active: false } }).exec(); } catch {}
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
              const updated = await UserModel.findById(d.user_id).select('wallet').lean().exec() as any;
              await WalletLedgerModel.create({ userId: d.user_id, delta, reason: 'round_settlement', ref: game.id, balanceAfter: updated?.wallet });
              if (updated?.wallet != null) emitWalletUpdate(String(d.user_id), String(updated.wallet), 'round_settlement', game.id);
            } catch {}
          }));
          // Rake credit to a configured wallet user
          try {
            if (rakeAmount > 0 && process.env.RAKE_WALLET_USER_ID) {
              const rakeUserId = String(process.env.RAKE_WALLET_USER_ID);
              await UserModel.updateOne({ _id: rakeUserId }, [{ $set: { wallet: { $toString: { $round: [{ $add: [{ $toDouble: '$wallet' }, rakeAmount] }, 2] } } } }]).exec();
              const updated = await UserModel.findById(rakeUserId).select('wallet').lean().exec() as any;
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
        socket.emit('declare', { code: ErrorCodes.INVALID_REQUEST, message: 'Invalid declare payload' });
      }
    });

    // leave-table: remove user from table room and update state
    socket.on('leave-table', (payload) => {
      try {
        if (payload && typeof payload === 'object' && alreadyProcessed(socket.id, (payload as any).idempotencyKey)) return;
      } catch {}
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
              code: ErrorCodes.SUCCESS,
              message: 'Player left',
              table_id: table.id,
              joined: joinedCount,
              total: table.noOfPlayers,
            });
          } catch {}
          // Release any active hold for this user and table when DB is connected
          (async () => {
            try {
              if (isDbConnected()) {
                const holds: any[] = await WalletHoldModel.find({ userId: String(session.userId), tableId: table.id, active: true }).lean().exec() as any[];
                for (const h of holds) {
                  const amt = Number(h.amount || 0);
                  if (!Number.isFinite(amt) || amt === 0) continue;
                  try {
                    await WalletLedgerModel.create({ userId: String(h.userId), delta: amt, reason: 'hold_release', ref: `leave:${table.id}` });
                    await UserModel.updateOne({ _id: h.userId }, [{ $set: { wallet: { $toString: { $round: [{ $add: [{ $toDouble: '$wallet' }, amt] }, 2] } } } }]).exec();
                    const updated: any = await UserModel.findById(h.userId).select('wallet').lean().exec();
                    if (updated?.wallet != null) emitWalletUpdate(String(h.userId), String(updated.wallet), 'hold_release', table.id);
          } catch {}
                }
                await WalletHoldModel.updateMany({ userId: String(session.userId), tableId: table.id, active: true }, { $set: { active: false } }).exec();
              }
            } catch {}
          })();
        }
      }
      // If game is ongoing, mark this user as packed
      if (game) {
        const seat = game.players.findIndex((u) => u === session.userId);
        if (seat >= 0) {
          game.packed[seat] = true;
          nsp.to(TABLE_ROOM(game.tableId)).emit('status', {
            code: ErrorCodes.SUCCESS,
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
      socket.emit('leave-table', { code: ErrorCodes.SUCCESS, message: 'Success' });
    });

    socket.on('disconnect', (reason) => {
      logSocket('disconnected', { socketId: socket.id, reason });
      const s = sessions.get(socket.id);
      if (s) {
        userIdToSocket.delete(s.userId);
        // Reconnect grace: retain session mapping for a short period before packing
        const graceMs = isTestEnv ? 0 : Math.max(5000, Number(process.env.RECONNECT_GRACE_MS || 15000));
        const userId = s.userId;
        const tableId = s.tableId;
        const seatNo = s.seatNo;
        // Remove socket-bound session immediately
        sessions.delete(socket.id);
        if (tableId && seatNo != null) {
          if (isTestEnv) {
            const game = [...games.values()].find((g) => g.tableId === tableId);
            if (game && seatNo >= 0) {
              game.packed[seatNo] = true;
              io.of('/rummy').to(TABLE_ROOM(game.tableId)).emit('status', {
                code: 200,
                message: 'Packed',
                game_id: game.id,
                table_id: game.tableId,
                currentTurn: game.currentTurn,
                deckCount: game.deck.length,
                discardTop: game.discardPile[game.discardPile.length - 1] || null,
                seats: game.players,
                phase: game.phase,
                turnDeadline: game.turnDeadline ?? null,
              });
            }
            return;
          }
          const t = setTimeout(() => {
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
                table_id: game.tableId,
                currentTurn: game.currentTurn,
                deckCount: game.deck.length,
                discardTop: game.discardPile[game.discardPile.length - 1] || null,
                seats: game.players,
                phase: game.phase,
                turnDeadline: game.turnDeadline ?? null,
              });
            }
          }, graceMs);
          try { if (typeof (t as any).unref === 'function') (t as any).unref(); } catch {}
          return;
        }
      } else {
        sessions.delete(socket.id);
      }
    });
  });

  return nsp;
}

export async function restoreSnapshots(): Promise<void> {
  if (!isDbConnected()) return;
  try {
    // Restore waiting tables
    const tables = await TableModel.find({}).lean().exec();
    for (const t of tables as any[]) {
      try {
        // Ensure presence in waitingTables map
        const id = String((t as any).tableId);
        const existing = waitingTables.get(id);
        if (!existing) {
          waitingTables.set(id, {
            id,
            bootValue: String((t as any).bootValue || '0'),
            noOfPlayers: Number((t as any).noOfPlayers || 2),
            status: (t as any).status === 'playing' ? 'waiting' : 'waiting',
            players: Array.isArray((t as any).players) ? (t as any).players : Array(Number((t as any).noOfPlayers || 2)).fill(''),
            createdAt: Date.now(),
            pointValue: Number((t as any).pointValue || 1),
          });
        }
      } catch {}
    }
  } catch {}
  try {
    // Clean up any game snapshots on boot (cannot restore hands/deck reliably yet)
    const gamesSnap = await GameModel.find({}).select('gameId tableId').lean().exec();
    for (const g of gamesSnap as any[]) {
      try { await GameModel.deleteOne({ gameId: (g as any).gameId }).exec(); } catch {}
      const tblId = String((g as any).tableId || '');
      const tbl = waitingTables.get(tblId);
      if (tbl) { tbl.status = 'waiting'; tbl.players = Array(tbl.noOfPlayers).fill(''); }
    }
  } catch {}
}


