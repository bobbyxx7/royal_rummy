import { Server } from 'socket.io';
import { createServer } from 'http';
import { AddressInfo } from 'net';
import { io as Client } from 'socket.io-client';
import { teenPattiNamespace } from '../teenpatti.namespace';
import { 
  createTeenPattiTable, 
  joinTeenPattiTable, 
  startTeenPattiGame,
  getTeenPattiGame,
  processBetAction,
  processShowAction,
  processPackAction,
  getPublicTables,
  findBestTable,
  getTableStats,
  cleanupEmptyTables,
  teenPattiTables,
  teenPattiGames,
  teenPattiSessions
} from '../teenpatti.state';
import { makeBotDecision, DEFAULT_BOT_CONFIGS, BotDifficulty } from '../teenpatti.bots';
import { evaluateTeenPattiHand, compareTeenPattiHands } from '../teenpatti.rules';

describe('Teen Patti Integration Tests', () => {
  let io: Server;
  let httpServer: any;
  let clientSocket: any;
  let serverAddr: AddressInfo;

  beforeAll((done) => {
    httpServer = createServer();
    io = new Server(httpServer);
    teenPattiNamespace(io);
    
    httpServer.listen(() => {
      serverAddr = httpServer.address() as AddressInfo;
      done();
    });
  });

  afterAll((done) => {
    io.close();
    httpServer.close();
    done();
  });

  beforeEach((done) => {
    // Clear all state before each test
    teenPattiTables.clear();
    teenPattiGames.clear();
    teenPattiSessions.clear();
    
    clientSocket = Client(`http://localhost:${serverAddr.port}/teenpatti`, {
      query: {
        userId: 'test-user-1',
        token: 'test-token-1'
      }
    });
    
    clientSocket.on('connect', done);
  });

  afterEach((done) => {
    if (clientSocket.connected) {
      clientSocket.disconnect();
    }
    done();
  });

  describe('Public Table Management', () => {
    test('should create and manage public tables', () => {
      // Create tables with different boot values
      const table1 = createTeenPattiTable('100', 2);
      const table2 = createTeenPattiTable('200', 6);
      const table3 = createTeenPattiTable('100', 6);

      expect(teenPattiTables.size).toBe(3);
      expect(table1.bootValue).toBe('100');
      expect(table1.noOfPlayers).toBe(2);
      expect(table2.bootValue).toBe('200');
      expect(table2.noOfPlayers).toBe(6);
    });

    test('should find best table for players', () => {
      // Create tables
      createTeenPattiTable('100', 2);
      createTeenPattiTable('100', 6);
      createTeenPattiTable('200', 2);

      // Find table for 2 players with 100 boot value
      const bestTable = findBestTable('100', 2);
      expect(bestTable).toBeDefined();
      expect(bestTable!.bootValue).toBe('100');
      expect(bestTable!.noOfPlayers).toBe(2);
    });

    test('should get public tables with filters', () => {
      // Create tables
      createTeenPattiTable('100', 2);
      createTeenPattiTable('100', 6);
      createTeenPattiTable('200', 2);

      // Get tables by boot value
      const tables100 = getPublicTables('100');
      expect(tables100).toHaveLength(2);

      // Get tables by player count
      const tables2Player = getPublicTables(undefined, 2);
      expect(tables2Player).toHaveLength(2);

      // Get tables by both filters
      const tables100And2 = getPublicTables('100', 2);
      expect(tables100And2).toHaveLength(1);
    });

    test('should provide table statistics', () => {
      // Create tables
      createTeenPattiTable('100', 2);
      createTeenPattiTable('200', 6);

      const stats = getTableStats();
      expect(stats.totalTables).toBe(2);
      expect(stats.waitingTables).toBe(2);
      expect(stats.playingTables).toBe(0);
      expect(stats.totalPlayers).toBe(0);
      expect(stats.activeGames).toBe(0);
    });

    test('should cleanup empty tables', () => {
      // Create a table
      const table = createTeenPattiTable('100', 2);
      
      // Manually set creation time to simulate old table
      (table as any).createdAt = Date.now() - 400000; // 6+ minutes ago
      
      cleanupEmptyTables();
      
      // Table should be removed
      expect(teenPattiTables.has(table.id)).toBe(false);
    });
  });

  describe('Game Flow Integration', () => {
    test('should complete full game from start to finish', async () => {
      // Create table and join players
      const table = createTeenPattiTable('100', 2);
      const player1 = joinTeenPattiTable(table.id, 'player-1');
      const player2 = joinTeenPattiTable(table.id, 'player-2');

      expect(player1.success).toBe(true);
      expect(player2.success).toBe(true);

      // Start game
      const gameResult = startTeenPattiGame(table.id);
      expect(gameResult.success).toBe(true);

      const game = getTeenPattiGame(table.id);
      expect(game).toBeDefined();
      expect(game!.phase).toBe('dealing');

      // Simulate betting rounds
      const betResult1 = processBetAction(table.id, 'player-1', 'call');
      expect(betResult1.success).toBe(true);

      const betResult2 = processBetAction(table.id, 'player-2', 'raise', 200);
      expect(betResult2.success).toBe(true);

      // Simulate showdown
      const showResult = processShowAction(table.id, 'player-1');
      expect(showResult.success).toBe(true);
      expect(showResult.winner).toBeDefined();
      expect(showResult.winnings).toBeDefined();
    });

    test('should handle player packing during game', () => {
      // Create table and start game
      const table = createTeenPattiTable('100', 3);
      joinTeenPattiTable(table.id, 'player-1');
      joinTeenPattiTable(table.id, 'player-2');
      joinTeenPattiTable(table.id, 'player-3');

      startTeenPattiGame(table.id);

      // Player 2 packs
      const packResult = processPackAction(table.id, 'player-2');
      expect(packResult.success).toBe(true);
      expect(packResult.activePlayers).toBe(2);

      // Game should continue with remaining players
      const game = getTeenPattiGame(table.id);
      expect(game!.players.find(p => p.userId === 'player-2')!.hasFolded).toBe(true);
    });

    test('should determine winner correctly', () => {
      // Create a simple game scenario
      const table = createTeenPattiTable('100', 2);
      joinTeenPattiTable(table.id, 'player-1');
      joinTeenPattiTable(table.id, 'player-2');

      startTeenPattiGame(table.id);
      const game = getTeenPattiGame(table.id);

      // Manually set cards for testing
      game!.players[0].cards = ['H1', 'H2', 'H3']; // Pure sequence
      game!.players[1].cards = ['D1', 'D5', 'D9']; // Color

      // Evaluate hands
      const hand1 = evaluateTeenPattiHand(game!.players[0].cards);
      const hand2 = evaluateTeenPattiHand(game!.players[1].cards);

      expect(hand1.rank).toBe('pure_sequence');
      expect(hand2.rank).toBe('color');

      // Compare hands
      const comparison = compareTeenPattiHands(game!.players[0].cards, game!.players[1].cards);
      expect(comparison).toBeGreaterThan(0); // Hand 1 should win
    });
  });

  test('should handle bot players correctly', () => {
    // Create table with bots
    const table = createTeenPattiTable('100', 3);
    joinTeenPattiTable(table.id, 'player-1');
    
    // Add bot players with required properties
    const bot1 = { 
      userId: 'bot-1', 
      name: 'Bot 1', 
      isBot: true, 
      difficulty: BotDifficulty.MEDIUM,
      seatNo: 1,
      isConnected: true,
      currentBet: 0,
      totalBet: 0,
      hasFolded: false,
      isSeen: false,
      lastAction: 'none',
      lastActionTime: 0,
      cards: [],
      chips: 1000
    };
    const bot2 = { 
      userId: 'bot-2', 
      name: 'Bot 2', 
      isBot: true, 
      difficulty: BotDifficulty.HARD,
      seatNo: 2,
      isConnected: true,
      currentBet: 0,
      totalBet: 0,
      hasFolded: false,
      isSeen: false,
      lastAction: 'none',
      lastActionTime: 0,
      cards: [],
      chips: 1000
    };
    
    table.players.push(bot1, bot2);

    // Test bot decision making
    const botDecision = makeBotDecision(bot1, getTeenPattiGame(table.id)!, DEFAULT_BOT_CONFIGS[BotDifficulty.MEDIUM]);
    expect(botDecision).toBeDefined();
    expect(['call', 'raise', 'pack']).toContain(botDecision.action);
  });

  describe('Socket Event Integration', () => {
    test('should handle get-public-tables event', (done) => {
      // Create some tables
      createTeenPattiTable('100', 2);
      createTeenPattiTable('200', 6);

      clientSocket.emit('get-public-tables', { boot_value: '100' });

      clientSocket.on('get-public-tables', (response: any) => {
        expect(response.code).toBe('SUCCESS');
        expect(response.tables).toHaveLength(1);
        expect(response.tables[0].boot_value).toBe('100');
        expect(response.stats).toBeDefined();
        done();
      });
    });

    test('should handle quick-join event', (done) => {
      // Create a table
      const table = createTeenPattiTable('100', 2);

      clientSocket.emit('quick-join', { boot_value: '100', no_of_players: 2 });

      clientSocket.on('quick-join', (response: any) => {
        expect(response.code).toBe('SUCCESS');
        expect(response.table_id).toBe(table.id);
        expect(response.seat_no).toBeDefined();
        done();
      });
    });

    test('should handle bet event', (done) => {
      // Setup game
      const table = createTeenPattiTable('100', 2);
      joinTeenPattiTable(table.id, 'test-user-1');
      joinTeenPattiTable(table.id, 'test-user-2');
      startTeenPattiGame(table.id);

      clientSocket.emit('bet', { action: 'call' });

      clientSocket.on('bet', (response: any) => {
        expect(response.code).toBe('SUCCESS');
        done();
      });
    });

    test('should handle show event', (done) => {
      // Setup game
      const table = createTeenPattiTable('100', 2);
      joinTeenPattiTable(table.id, 'test-user-1');
      joinTeenPattiTable(table.id, 'test-user-2');
      startTeenPattiGame(table.id);

      clientSocket.emit('show', {});

      clientSocket.on('show', (response: any) => {
        expect(response.code).toBe('SUCCESS');
        done();
      });
    });

    test('should handle pack event', (done) => {
      // Setup game
      const table = createTeenPattiTable('100', 2);
      joinTeenPattiTable(table.id, 'test-user-1');
      joinTeenPattiTable(table.id, 'test-user-2');
      startTeenPattiGame(table.id);

      clientSocket.emit('pack', {});

      clientSocket.on('pack', (response: any) => {
        expect(response.code).toBe('SUCCESS');
        done();
      });
    });
  });

  describe('Error Handling', () => {
    test('should handle invalid table operations', () => {
      // Try to join non-existent table
      const result = joinTeenPattiTable('non-existent', 'player-1');
      expect(result.success).toBe(false);
      expect(result.message).toContain('not found');

      // Try to start game on non-existent table
      const gameResult = startTeenPattiGame('non-existent');
      expect(gameResult.success).toBe(false);
      expect(gameResult.message).toContain('not found');
    });

    test('should handle invalid bet actions', () => {
      // Create table and start game
      const table = createTeenPattiTable('100', 2);
      joinTeenPattiTable(table.id, 'player-1');
      joinTeenPattiTable(table.id, 'player-2');
      startTeenPattiGame(table.id);

      // Try to bet on non-existent player
      const result = processBetAction(table.id, 'non-existent', 'call');
      expect(result.success).toBe(false);
      expect(result.message).toContain('not found');
    });

    test('should handle rate limiting', (done) => {
      // Send multiple requests quickly
      for (let i = 0; i < 10; i++) {
        clientSocket.emit('get-public-tables', {});
      }

      let rateLimitedCount = 0;
      clientSocket.on('get-public-tables', (response: any) => {
        if (response.code === 'RATE_LIMITED') {
          rateLimitedCount++;
        }
        
        if (rateLimitedCount > 0) {
          expect(response.message).toContain('too quickly');
          done();
        }
      });
    });
  });

  describe('Performance and Scalability', () => {
    test('should handle multiple concurrent games', () => {
      const gameCount = 10;
      const tables = [];

      // Create multiple games
      for (let i = 0; i < gameCount; i++) {
        const table = createTeenPattiTable('100', 2);
        joinTeenPattiTable(table.id, `player-${i}-1`);
        joinTeenPattiTable(table.id, `player-${i}-2`);
        startTeenPattiGame(table.id);
        tables.push(table);
      }

      expect(teenPattiGames.size).toBe(gameCount);
      expect(teenPattiTables.size).toBe(gameCount);

      // Verify all games are active
      tables.forEach(table => {
        const game = getTeenPattiGame(table.id);
        expect(game).toBeDefined();
        expect(game!.phase).toBe('dealing');
      });
    });

    test('should cleanup resources efficiently', () => {
      // Create many tables
      for (let i = 0; i < 20; i++) {
        createTeenPattiTable('100', 2);
      }

      expect(teenPattiTables.size).toBe(20);

      // Cleanup
      cleanupEmptyTables();
      
      // Should still have tables (they're not old enough to be cleaned up)
      expect(teenPattiTables.size).toBeGreaterThan(0);
    });
  });
});
