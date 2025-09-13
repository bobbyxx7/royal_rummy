import { Server } from 'socket.io';
import { validateUserToken } from '../auth';
import { isDbConnected } from '../auth';
import { RoundResultModel, UserModel, WalletLedgerModel, WalletHoldModel } from '../db';
import { usersById } from '../services/auth.routes';
import { logSocket } from '../logger';
import { ErrorCodes } from '../errors';
import { 
  createTeenPattiTable, 
  findTeenPattiSessionBySocket, 
  joinTeenPattiTable, 
  startTeenPattiGame,
  getTeenPattiGame,
  processBetAction,
  processShowAction,
  processPackAction,
  createTeenPattiSession,
  startTurnTimer,
  clearTurnTimer,
  teenPattiUserIdToSocket,
  teenPattiTables,
  getPublicTables,
  findBestTable,
  getTableStats
} from './teenpatti.state';
import { makeBotDecision, DEFAULT_BOT_CONFIGS, BotDifficulty } from './teenpatti.bots';
import { getTeenPattiTableSchema, joinTeenPattiTableSchema, startTeenPattiGameSchema, teenPattiBetSchema } from './teenpatti.schemas';

// Constants
const TEEN_PATTI_ROOM = (tableId: string) => `teenpatti:${tableId}`;
const MAX_PLAYERS_PER_TABLE = 6;
const MIN_PLAYERS_TO_START = 2;

// Rate limiting for socket events
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

export function teenPattiNamespace(io: Server) {
  const nsp = io.of('/teenpatti');
  
  // Seed default waiting tables for quick-join
  try {
    // Create default tables for common boot values
    const defaultBootValues = ['50', '100', '200', '500', '1000', '2000'];
    defaultBootValues.forEach(bootValue => {
      createTeenPattiTable(bootValue, 2); // 2-player tables by default
      createTeenPattiTable(bootValue, 6); // 6-player tables by default
    });
  } catch (error) {
    logSocket('error', { error: 'Failed to seed default tables', details: error });
  }

  nsp.on('connection', async (socket) => {
    logSocket('connected', { socketId: socket.id, namespace: '/teenpatti' });

    // Create session on connection
    const { userId, token } = socket.handshake.query;
    if (userId && token) {
      createTeenPattiSession(socket.id, String(userId), String(token));
    }

    // Authentication middleware
    socket.use(async (packet, next) => {
      try {
        const [event, data] = packet;
        
        // Skip auth for ping/health events
        if (['ping', 'health_check'].includes(event)) {
          return next();
        }
        
        const session = findTeenPattiSessionBySocket(socket.id);
        if (!session) {
          return next(new Error('Unauthorized: No session found'));
        }
        
        // Validate user token for sensitive operations
        if (['get-table', 'join-table', 'start-game', 'bet', 'show'].includes(event)) {
          const { user_id, token } = data || {};
          const tokenToCheck = String(token || session.token || '');
          const ok = await validateUserToken(String(user_id || session.userId), tokenToCheck);
          
          if (!ok) {
            return next(new Error('Unauthorized: Invalid token'));
          }
        }
        
        next();
      } catch (error) {
        next(new Error(`Authentication error: ${error}`));
      }
    });

    // Ping/Pong for connection health
    socket.on('ping', (data) => {
      socket.emit('pong', data ?? 'pong');
    });

    socket.on('health_check', () => {
      socket.emit('health_ok', { timestamp: Date.now() });
    });

    // Get table - matchmaking for Teen Patti
    socket.on('get-table', async (payload) => {
      if (isRateLimited(socket.id, 'get-table', 1000)) {
        socket.emit('get-table', { 
          code: ErrorCodes.RATE_LIMITED, 
          message: 'Rate limited. Please wait before requesting another table.' 
        });
        return;
      }

      try {
        const parsed = getTeenPattiTableSchema.safeParse(payload || {});
        if (!parsed.success) {
          socket.emit('get-table', { 
            code: ErrorCodes.INVALID_REQUEST, 
            message: 'Invalid request format',
            details: parsed.error.issues 
          });
          return;
        }

        const session = findTeenPattiSessionBySocket(socket.id);
        if (!session) {
          socket.emit('get-table', { 
            code: ErrorCodes.UNAUTHORIZED, 
            message: 'Session not found. Please reconnect.' 
          });
          return;
        }

        const { user_id, token: payloadToken, boot_value, no_of_players } = parsed.data;
        const tokenToCheck = String(payloadToken || session.token || '');
        const ok = await validateUserToken(String(user_id || session.userId), tokenToCheck);
        
        if (!ok) {
          socket.emit('get-table', { 
            code: ErrorCodes.UNAUTHORIZED, 
            message: 'Invalid authentication token' 
          });
          return;
        }

        // Create or find table with specified boot value and player count
        const table = createTeenPattiTable(
          String(boot_value ?? '100'), 
          Number(no_of_players ?? 2)
        );

        // Join the table room
        socket.join(TEEN_PATTI_ROOM(table.id));
        session.tableId = table.id;

        logSocket('info', { 
          event: 'get-table', 
          userId: session.userId, 
          tableId: table.id, 
          bootValue: table.bootValue 
        });

        socket.emit('get-table', {
          code: ErrorCodes.SUCCESS,
          message: 'Table found successfully',
          table_id: table.id,
          boot_value: table.bootValue,
          no_of_players: table.noOfPlayers,
          current_players: table.players.length,
          status: table.status
        });

      } catch (error) {
        logSocket('error', { 
          event: 'get-table', 
          error: error instanceof Error ? error.message : String(error), 
          socketId: socket.id 
        });
        
        socket.emit('get-table', { 
          code: ErrorCodes.SERVER_ERROR, 
          message: 'Internal server error. Please try again.' 
        });
      }
    });

    // Join table
    socket.on('join-table', async (payload) => {
      if (isRateLimited(socket.id, 'join-table', 2000)) {
        socket.emit('join-table', { 
          code: ErrorCodes.RATE_LIMITED, 
          message: 'Rate limited. Please wait before joining another table.' 
        });
        return;
      }

      try {
        const parsed = joinTeenPattiTableSchema.safeParse(payload || {});
        if (!parsed.success) {
          socket.emit('join-table', { 
            code: ErrorCodes.INVALID_REQUEST, 
            message: 'Invalid join request format',
            details: parsed.error.issues 
          });
          return;
        }

        const session = findTeenPattiSessionBySocket(socket.id);
        if (!session) {
          socket.emit('join-table', { 
            code: ErrorCodes.UNAUTHORIZED, 
            message: 'Session not found. Please reconnect.' 
          });
          return;
        }

        const { user_id, token: payloadToken, table_id } = parsed.data;
        const tokenToCheck = String(payloadToken || session.token || '');
        const ok = await validateUserToken(String(user_id || session.userId), tokenToCheck);
        
        if (!ok) {
          socket.emit('join-table', { 
            code: ErrorCodes.UNAUTHORIZED, 
            message: 'Invalid authentication token' 
          });
          return;
        }

        // Join the specified table
        const result = joinTeenPattiTable(table_id, session.userId);
        
        if (!result.success) {
          socket.emit('join-table', { 
            code: ErrorCodes.INVALID_REQUEST, 
            message: result.message 
          });
          return;
        }

        // Update session with table info
        session.tableId = table_id;
        session.seatNo = result.seatNo;

        // Join the table room
        socket.join(TEEN_PATTI_ROOM(table_id));

        logSocket('info', { 
          event: 'join-table', 
          userId: session.userId, 
          tableId: table_id, 
          seatNo: result.seatNo 
        });

        // Emit success to joining player
        socket.emit('join-table', {
          code: ErrorCodes.SUCCESS,
          message: 'Successfully joined table',
          table_id: table_id,
          seat_no: result.seatNo,
          current_players: result.currentPlayers,
          total_players: result.totalPlayers
        });

        // Notify other players in the table
        socket.to(TEEN_PATTI_ROOM(table_id)).emit('player-joined', {
          user_id: session.userId,
          seat_no: result.seatNo,
          current_players: result.currentPlayers,
          total_players: result.totalPlayers
        });

        // Check if table is ready to start
        if (result.currentPlayers >= MIN_PLAYERS_TO_START && result.canStart) {
          // Auto-start game after short delay
          setTimeout(() => {
            startTeenPattiGame(table_id);
          }, 3000); // 3 second delay for players to see who joined
        }

      } catch (error) {
        logSocket('error', { 
          event: 'join-table', 
          error: error instanceof Error ? error.message : String(error), 
          socketId: socket.id 
        });
        
        socket.emit('join-table', { 
          code: ErrorCodes.SERVER_ERROR, 
          message: 'Internal server error. Please try again.' 
        });
      }
    });

    // Start game (admin/auto-triggered)
    socket.on('start-game', async (payload) => {
      if (isRateLimited(socket.id, 'start-game', 5000)) {
        socket.emit('start-game', { 
          code: ErrorCodes.RATE_LIMITED, 
          message: 'Rate limited. Please wait before starting another game.' 
        });
        return;
      }

      try {
        const parsed = startTeenPattiGameSchema.safeParse(payload || {});
        if (!parsed.success) {
          socket.emit('start-game', { 
            code: ErrorCodes.INVALID_REQUEST, 
            message: 'Invalid start game request format',
            details: parsed.error.issues 
          });
          return;
        }

        const session = findTeenPattiSessionBySocket(socket.id);
        if (!session) {
          socket.emit('start-game', { 
            code: ErrorCodes.UNAUTHORIZED, 
            message: 'Session not found. Please reconnect.' 
          });
          return;
        }

        const { table_id } = parsed.data;

        // Validate that the user is at this table
        if (session.tableId !== table_id) {
          socket.emit('start-game', { 
            code: ErrorCodes.INVALID_REQUEST, 
            message: 'You are not at this table' 
          });
          return;
        }

        // Start the game
        const result = startTeenPattiGame(table_id);
        
        if (!result.success) {
          socket.emit('start-game', { 
            code: ErrorCodes.INVALID_REQUEST, 
            message: result.message 
          });
          return;
        }

        logSocket('info', { 
          event: 'start-game', 
          tableId: table_id, 
          gameId: result.gameId 
        });

        // Notify all players in the table that game is starting
        nsp.to(TEEN_PATTI_ROOM(table_id)).emit('game-start', {
          code: ErrorCodes.SUCCESS,
          message: 'Game starting',
          game_id: result.gameId,
          table_id: table_id,
          players: result.players,
          dealer: result.dealer,
          boot_value: result.bootValue
        });

        // Deal cards and start first turn
        setTimeout(() => {
          const game = getTeenPattiGame(result.gameId!);
          if (game) {
            // Notify each player of their cards privately
            game.players.forEach(player => {
              if (!player.isBot && player.cards) {
                const playerSocket = teenPattiUserIdToSocket.get(player.userId);
                if (playerSocket) {
                  const socket = nsp.sockets.get(playerSocket);
                  socket?.emit('deal-cards', {
                    cards: player.cards,
                    your_turn: game.currentTurn === player.seatNo
                  });
                }
              }
            });

            // Notify all players of game state
            nsp.to(TEEN_PATTI_ROOM(table_id)).emit('game-state', {
              phase: game.phase,
              current_turn: game.currentTurn,
              pot: game.pot,
              min_bet: game.minBet,
              current_bet: game.currentBet,
              active_players: game.players.filter(p => !p.hasFolded).length
            });

            // Start turn timer for first player
            const currentPlayer = game.players[game.currentTurn];
            if (currentPlayer && !currentPlayer.isBot) {
              startTurnTimer(game.id, currentPlayer.userId);
            } else if (currentPlayer?.isBot) {
              // Process bot turn immediately
              processBotTurns(table_id, nsp);
            }
          }
        }, 2000); // 2 second delay for dealing animation

      } catch (error) {
        logSocket('error', { 
          event: 'start-game', 
          error: error instanceof Error ? error.message : String(error), 
          socketId: socket.id 
        });
        
        socket.emit('start-game', { 
          code: ErrorCodes.SERVER_ERROR, 
          message: 'Internal server error. Please try again.' 
        });
      }
    });

    // Leave table
    socket.on('leave-table', async () => {
      try {
        const session = findTeenPattiSessionBySocket(socket.id);
        if (!session || !session.tableId) {
          socket.emit('leave-table', { 
            code: ErrorCodes.INVALID_REQUEST, 
            message: 'Not currently at any table' 
          });
          return;
        }

        const tableId = session.tableId;
        
        // Leave the table room
        socket.leave(TEEN_PATTI_ROOM(tableId));
        
        // Clear session table info
        session.tableId = undefined;
        session.seatNo = undefined;

        logSocket('info', { 
          event: 'leave-table', 
          userId: session.userId, 
          tableId: tableId 
        });

        // Notify other players
        socket.to(TEEN_PATTI_ROOM(tableId)).emit('player-left', {
          user_id: session.userId,
          table_id: tableId
        });

        socket.emit('leave-table', {
          code: ErrorCodes.SUCCESS,
          message: 'Successfully left table'
        });

      } catch (error) {
        logSocket('error', { 
          event: 'leave-table', 
          error: error instanceof Error ? error.message : String(error), 
          socketId: socket.id 
        });
        
        socket.emit('leave-table', { 
          code: ErrorCodes.SERVER_ERROR, 
          message: 'Internal server error. Please try again.' 
        });
      }
    });

    // Betting action (call, raise, pack)
    socket.on('bet', async (payload) => {
      if (isRateLimited(socket.id, 'bet', 500)) {
        socket.emit('bet', { 
          code: ErrorCodes.RATE_LIMITED, 
          message: 'Rate limited. Please wait before making another bet.' 
        });
        return;
      }

      try {
        const parsed = teenPattiBetSchema.safeParse(payload || {});
        if (!parsed.success) {
          socket.emit('bet', { 
            code: ErrorCodes.INVALID_REQUEST, 
            message: 'Invalid bet request format',
            details: parsed.error.issues 
          });
          return;
        }

        const session = findTeenPattiSessionBySocket(socket.id);
        if (!session || !session.tableId) {
          socket.emit('bet', { 
            code: ErrorCodes.UNAUTHORIZED, 
            message: 'Not currently at any table' 
          });
          return;
        }

        const { action, amount, target_player_id } = parsed.data;
        
        // Process the bet action
        const result = processBetAction(
          session.tableId, 
          session.userId, 
          action, 
          amount, 
          target_player_id
        );
        
        if (!result.success) {
          socket.emit('bet', { 
            code: ErrorCodes.INVALID_REQUEST, 
            message: result.message 
          });
          return;
        }

        logSocket('info', { 
          event: 'bet', 
          userId: session.userId, 
          tableId: session.tableId,
          action,
          amount 
        });

        // Emit success to betting player
        socket.emit('bet', {
          code: ErrorCodes.SUCCESS,
          message: 'Bet placed successfully',
          action,
          amount,
          new_pot: result.newPot,
          next_turn: result.nextTurn
        });

        // Notify all players in the table of the bet
        nsp.to(TEEN_PATTI_ROOM(session.tableId)).emit('bet-update', {
          player_id: session.userId,
          action,
          amount,
          pot: result.newPot,
          current_turn: result.nextTurn,
          phase: result.gamePhase,
          can_show: result.canShow
        });

        // Start turn timer for next player
        const table = teenPattiTables.get(session.tableId);
        if (table?.currentGameId && result.nextTurn !== undefined) {
          const game = getTeenPattiGame(table.currentGameId);
          if (game) {
            const nextPlayer = game.players[result.nextTurn];
            if (nextPlayer && !nextPlayer.isBot && !nextPlayer.hasFolded) {
              startTurnTimer(game.id, nextPlayer.userId);
            }
          }
        }

        // Process bot turns if needed
        await processBotTurns(session.tableId, nsp);

      } catch (error) {
        logSocket('error', { 
          event: 'bet', 
          error: error instanceof Error ? error.message : String(error), 
          socketId: socket.id 
        });
        
        socket.emit('bet', { 
          code: ErrorCodes.SERVER_ERROR, 
          message: 'Internal server error. Please try again.' 
        });
      }
    });

    // Show action (reveal cards)
    socket.on('show', async (payload) => {
      if (isRateLimited(socket.id, 'show', 1000)) {
        socket.emit('show', { 
          code: ErrorCodes.RATE_LIMITED, 
          message: 'Rate limited. Please wait before showing again.' 
        });
        return;
      }

      try {
        const session = findTeenPattiSessionBySocket(socket.id);
        if (!session || !session.tableId) {
          socket.emit('show', { 
            code: ErrorCodes.UNAUTHORIZED, 
            message: 'Not currently at any table' 
          });
          return;
        }

        const { target_player_id } = payload || {};
        
        // Process the show action
        const result = processShowAction(
          session.tableId, 
          session.userId, 
          target_player_id
        );
        
        if (!result.success) {
          socket.emit('show', { 
            code: ErrorCodes.INVALID_REQUEST, 
            message: result.message 
          });
          return;
        }

        logSocket('info', { 
          event: 'show', 
          userId: session.userId, 
          tableId: session.tableId,
          targetPlayerId: target_player_id 
        });

        // Emit success to showing player
        socket.emit('show', {
          code: ErrorCodes.SUCCESS,
          message: 'Show action successful',
          winner: result.winner,
          hands: result.hands
        });

        // Notify all players of the showdown
        nsp.to(TEEN_PATTI_ROOM(session.tableId)).emit('showdown', {
          challenger: session.userId,
          target: target_player_id,
          winner: result.winner,
          hands: result.hands,
          winnings: result.winnings
        });

      } catch (error) {
        logSocket('error', { 
          event: 'show', 
          error: error instanceof Error ? error.message : String(error), 
          socketId: socket.id 
        });
        
        socket.emit('show', { 
          code: ErrorCodes.SERVER_ERROR, 
          message: 'Internal server error. Please try again.' 
        });
      }
    });

    // Pack action (fold)
    socket.on('pack', async () => {
      try {
        const session = findTeenPattiSessionBySocket(socket.id);
        if (!session || !session.tableId) {
          socket.emit('pack', { 
            code: ErrorCodes.UNAUTHORIZED, 
            message: 'Not currently at any table' 
          });
          return;
        }
        
        // Process the pack action
        const result = processPackAction(session.tableId, session.userId);
        
        if (!result.success) {
          socket.emit('pack', { 
            code: ErrorCodes.INVALID_REQUEST, 
            message: result.message 
          });
          return;
        }

        logSocket('info', { 
          event: 'pack', 
          userId: session.userId, 
          tableId: session.tableId 
        });

        // Emit success to packing player
        socket.emit('pack', {
          code: ErrorCodes.SUCCESS,
          message: 'Packed successfully'
        });

        // Notify all players of the pack
        nsp.to(TEEN_PATTI_ROOM(session.tableId)).emit('player-packed', {
          player_id: session.userId,
          current_turn: result.nextTurn,
          active_players: result.activePlayers
        });

        // Check if game ended due to packing
        if (result.gameEnded) {
          nsp.to(TEEN_PATTI_ROOM(session.tableId)).emit('game-end', {
            winner: result.winner,
            reason: 'other_players_packed',
            winnings: result.winnings
          });
        } else {
          // Process bot turns if needed
          await processBotTurns(session.tableId, nsp);
        }
      } catch (error) {
        logSocket('error', { 
          event: 'pack', 
          error: error.message, 
          socketId: socket.id 
        });
        
        socket.emit('pack', { 
          code: ErrorCodes.SERVER_ERROR, 
          message: 'Internal server error. Please try again.' 
        });
      }
    });

    // Get public tables
    socket.on('get-public-tables', async (payload) => {
      if (isRateLimited(socket.id, 'get-public-tables', 2000)) {
        socket.emit('get-public-tables', { 
          code: ErrorCodes.RATE_LIMITED, 
          message: 'Rate limited. Please wait before requesting tables again.' 
        });
        return;
      }

      try {
        const { boot_value, no_of_players } = payload || {};
        
        const tables = getPublicTables(boot_value, no_of_players);
        const stats = getTableStats();
        
        logSocket('info', { 
          event: 'get-public-tables', 
          socketId: socket.id,
          bootValue: boot_value,
          noOfPlayers: no_of_players,
          tableCount: tables.length
        });

        socket.emit('get-public-tables', {
          code: ErrorCodes.SUCCESS,
          message: 'Public tables retrieved successfully',
          tables: tables.map(table => ({
            id: table.id,
            boot_value: table.bootValue,
            no_of_players: table.noOfPlayers,
            current_players: table.players.length,
            status: table.status,
            created_at: table.createdAt,
            min_players: 2,
            max_players: table.noOfPlayers
          })),
          stats
        });

      } catch (error) {
        logSocket('error', { 
          event: 'get-public-tables', 
          error: error.message, 
          socketId: socket.id 
        });
        
        socket.emit('get-public-tables', { 
          code: ErrorCodes.SERVER_ERROR, 
          message: 'Internal server error. Please try again.' 
        });
      }
    });

    // Quick join table
    socket.on('quick-join', async (payload) => {
      if (isRateLimited(socket.id, 'quick-join', 3000)) {
        socket.emit('quick-join', { 
          code: ErrorCodes.RATE_LIMITED, 
          message: 'Rate limited. Please wait before joining again.' 
        });
        return;
      }

      try {
        const session = findTeenPattiSessionBySocket(socket.id);
        if (!session) {
          socket.emit('quick-join', { 
            code: ErrorCodes.UNAUTHORIZED, 
            message: 'Session not found. Please reconnect.' 
          });
          return;
        }

        const { boot_value, no_of_players } = payload || {};
        
        if (!boot_value || !no_of_players) {
          socket.emit('quick-join', { 
            code: ErrorCodes.INVALID_REQUEST, 
            message: 'Boot value and player count are required' 
          });
          return;
        }

        // Find or create the best table
        const table = findBestTable(boot_value, no_of_players);
        if (!table) {
          socket.emit('quick-join', { 
            code: ErrorCodes.SERVER_ERROR, 
            message: 'Failed to create or find table' 
          });
          return;
        }

        // Join the table
        const result = joinTeenPattiTable(table.id, session.userId);
        
        if (!result.success) {
          socket.emit('quick-join', { 
            code: ErrorCodes.INVALID_REQUEST, 
            message: result.message 
          });
          return;
        }

        // Update session with table info
        session.tableId = table.id;
        session.seatNo = result.seatNo;

        // Join the table room
        socket.join(TEEN_PATTI_ROOM(table.id));

        logSocket('info', { 
          event: 'quick-join', 
          userId: session.userId, 
          tableId: table.id, 
          seatNo: result.seatNo,
          bootValue: boot_value,
          noOfPlayers: no_of_players
        });

        // Emit success to joining player
        socket.emit('quick-join', {
          code: ErrorCodes.SUCCESS,
          message: 'Successfully joined table',
          table_id: table.id,
          seat_no: result.seatNo,
          current_players: result.currentPlayers,
          total_players: result.totalPlayers,
          boot_value: table.bootValue,
          no_of_players: table.noOfPlayers
        });

        // Notify other players in the table
        socket.to(TEEN_PATTI_ROOM(table.id)).emit('player-joined', {
          user_id: session.userId,
          seat_no: result.seatNo,
          current_players: result.currentPlayers,
          total_players: result.totalPlayers
        });

        // Check if table is ready to start
        if (result.currentPlayers >= 2 && result.canStart) {
          // Auto-start game after short delay
          setTimeout(() => {
            startTeenPattiGame(table.id);
          }, 3000); // 3 second delay for players to see who joined
        }

      } catch (error) {
        logSocket('error', { 
          event: 'quick-join', 
          error: error.message, 
          socketId: socket.id 
        });
        
        socket.emit('quick-join', { 
          code: ErrorCodes.SERVER_ERROR, 
          message: 'Internal server error. Please try again.' 
        });
      }
    });

    // Pack action handler
    socket.on('pack', async (data) => {
      try {
        if (isRateLimited(socket.id, 'pack', 1000)) {
          socket.emit('pack', { 
            code: ErrorCodes.RATE_LIMITED, 
            message: 'Please wait before packing again.' 
          });
          return;
        }

        const session = findTeenPattiSessionBySocket(socket.id);
        if (!session?.tableId) {
          socket.emit('pack', { 
            code: ErrorCodes.INVALID_REQUEST, 
            message: 'Not at a table.' 
          });
          return;
        }

        const result = processPackAction(session.tableId, session.userId);
        if (result.success) {
          socket.to(TEEN_PATTI_ROOM(session.tableId)).emit('player-packed', {
            player_id: session.userId,
            current_turn: result.nextTurn,
            active_players: result.activePlayers
          });

          if (result.gameEnded) {
            socket.to(TEEN_PATTI_ROOM(session.tableId)).emit('game-end', {
              winner: result.winner,
              reason: 'other_players_packed',
              winnings: result.winnings
            });
          }
        } else {
          socket.emit('pack', { 
            code: ErrorCodes.INVALID_REQUEST, 
            message: result.message || 'Cannot pack at this time.' 
          });
        }
      } catch (error) {
        logSocket('error', { 
          event: 'pack', 
          error: error.message, 
          socketId: socket.id 
        });
        
        socket.emit('pack', { 
          code: ErrorCodes.SERVER_ERROR, 
          message: 'Internal server error. Please try again.' 
        });
      }
    });

    // Disconnect handling
    socket.on('disconnect', () => {
      logSocket('disconnected', { socketId: socket.id, namespace: '/teenpatti' });
      
      // Clean up rate limiting
      lastEventTs.delete(socket.id);
      
      // Handle player disconnection from table
      const session = findTeenPattiSessionBySocket(socket.id);
      if (session?.tableId) {
        socket.to(TEEN_PATTI_ROOM(session.tableId)).emit('player-disconnected', {
          user_id: session.userId,
          table_id: session.tableId
        });
      }
    });

    // Error handling
    socket.on('error', (error) => {
      logSocket('error', { 
        event: 'socket-error', 
        error: error.message, 
        socketId: socket.id 
      });
    });
  });

  // Bot turn processing function
  async function processBotTurns(tableId: string, namespace: any): Promise<void> {
    try {
      const table = teenPattiTables.get(tableId);
      if (!table?.currentGameId) return;
      
      const game = getTeenPattiGame(table.currentGameId);
      if (!game || game.phase === 'finished') return;

      // Check if it's a bot's turn
      const currentPlayer = game.players[game.currentTurn];
      if (!currentPlayer || !currentPlayer.isBot || currentPlayer.hasFolded) return;

      // Add small delay for realistic bot behavior
      setTimeout(async () => {
        const botConfig = DEFAULT_BOT_CONFIGS[BotDifficulty.MEDIUM];
        const decision = makeBotDecision(currentPlayer, game, botConfig);
        
        logSocket('info', { 
          event: 'bot-action', 
          botId: currentPlayer.userId, 
          action: decision.action,
          reasoning: decision.reasoning 
        });

        // Process bot decision
        switch (decision.action) {
          case 'call':
          case 'raise':
            const betResult = processBetAction(
              tableId, 
              currentPlayer.userId, 
              decision.action, 
              decision.amount
            );
            
            if (betResult.success) {
              namespace.to(TEEN_PATTI_ROOM(tableId)).emit('bet-update', {
                player_id: currentPlayer.userId,
                action: decision.action,
                amount: decision.amount,
                pot: betResult.newPot,
                current_turn: betResult.nextTurn,
                phase: betResult.gamePhase,
                is_bot: true,
                reasoning: decision.reasoning
              });
              
              // Continue with next turn if it's another bot
              await processBotTurns(tableId, namespace);
            }
            break;
            
          case 'pack':
            const packResult = processPackAction(tableId, currentPlayer.userId);
            
            if (packResult.success) {
              namespace.to(TEEN_PATTI_ROOM(tableId)).emit('player-packed', {
                player_id: currentPlayer.userId,
                current_turn: packResult.nextTurn,
                active_players: packResult.activePlayers,
                is_bot: true,
                reasoning: decision.reasoning
              });
              
              if (packResult.gameEnded) {
                namespace.to(TEEN_PATTI_ROOM(tableId)).emit('game-end', {
                  winner: packResult.winner,
                  reason: 'other_players_packed',
                  winnings: packResult.winnings
                });
              } else {
                // Continue with next turn
                await processBotTurns(tableId, namespace);
              }
            }
            break;
            
          case 'show':
            if (decision.targetPlayerId) {
              const showResult = processShowAction(
                tableId, 
                currentPlayer.userId, 
                decision.targetPlayerId
              );
              
              if (showResult.success) {
                namespace.to(TEEN_PATTI_ROOM(tableId)).emit('showdown', {
                  challenger: currentPlayer.userId,
                  target: decision.targetPlayerId,
                  winner: showResult.winner,
                  hands: showResult.hands,
                  winnings: showResult.winnings,
                  is_bot: true,
                  reasoning: decision.reasoning
                });
              }
            }
            break;
        }
      }, 1000 + Math.random() * 2000); // 1-3 second delay for realistic bot timing
      
    } catch (error) {
      logSocket('error', { 
        event: 'bot-turn-error', 
        tableId, 
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  return nsp;
}
