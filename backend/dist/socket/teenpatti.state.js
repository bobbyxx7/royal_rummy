"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.teenPattiUserIdToSocket = exports.teenPattiGames = exports.teenPattiTables = exports.teenPattiSessions = void 0;
exports.generateTableId = generateTableId;
exports.generateGameId = generateGameId;
exports.generateBotId = generateBotId;
exports.createTeenPattiSession = createTeenPattiSession;
exports.findTeenPattiSessionBySocket = findTeenPattiSessionBySocket;
exports.findTeenPattiSessionByUserId = findTeenPattiSessionByUserId;
exports.removeTeenPattiSession = removeTeenPattiSession;
exports.createTeenPattiTable = createTeenPattiTable;
exports.findTeenPattiTable = findTeenPattiTable;
exports.getTeenPattiTable = getTeenPattiTable;
exports.removeTeenPattiTable = removeTeenPattiTable;
exports.joinTeenPattiTable = joinTeenPattiTable;
exports.leaveTeenPattiTable = leaveTeenPattiTable;
exports.startTeenPattiGame = startTeenPattiGame;
exports.getTeenPattiGame = getTeenPattiGame;
exports.removeTeenPattiGame = removeTeenPattiGame;
exports.getTeenPattiTablesByBootValue = getTeenPattiTablesByBootValue;
exports.getTeenPattiTablesByPlayerCount = getTeenPattiTablesByPlayerCount;
exports.getTeenPattiTablesByStatus = getTeenPattiTablesByStatus;
exports.getTeenPattiPlayerByUserId = getTeenPattiPlayerByUserId;
exports.updateTeenPattiPlayerConnection = updateTeenPattiPlayerConnection;
exports.cleanupTeenPattiState = cleanupTeenPattiState;
exports.startTurnTimer = startTurnTimer;
exports.clearTurnTimer = clearTurnTimer;
exports.processBetAction = processBetAction;
exports.processShowAction = processShowAction;
exports.processPackAction = processPackAction;
exports.getPublicTables = getPublicTables;
exports.findBestTable = findBestTable;
exports.getTableStats = getTableStats;
exports.cleanupEmptyTables = cleanupEmptyTables;
const logger_1 = require("../logger");
const teenpatti_rules_1 = require("./teenpatti.rules");
// In-memory state storage
exports.teenPattiSessions = new Map();
exports.teenPattiTables = new Map();
exports.teenPattiGames = new Map();
exports.teenPattiUserIdToSocket = new Map();
// Utility functions
function generateTableId() {
    return `tp_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}
function generateGameId() {
    return `tpg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}
function generateBotId() {
    return `bot_${Math.random().toString(36).substr(2, 9)}`;
}
// Session management
function createTeenPattiSession(socketId, userId, token) {
    const session = {
        socketId,
        userId,
        token,
        isConnected: true,
        lastSeen: Date.now()
    };
    exports.teenPattiSessions.set(socketId, session);
    exports.teenPattiUserIdToSocket.set(userId, socketId);
    (0, logger_1.logSocket)('info', {
        event: 'create-teenpatti-session',
        socketId,
        userId
    });
    return session;
}
function findTeenPattiSessionBySocket(socketId) {
    return exports.teenPattiSessions.get(socketId);
}
function findTeenPattiSessionByUserId(userId) {
    const socketId = exports.teenPattiUserIdToSocket.get(userId);
    return socketId ? exports.teenPattiSessions.get(socketId) : undefined;
}
function removeTeenPattiSession(socketId) {
    const session = exports.teenPattiSessions.get(socketId);
    if (session) {
        exports.teenPattiUserIdToSocket.delete(session.userId);
        exports.teenPattiSessions.delete(socketId);
        (0, logger_1.logSocket)('info', {
            event: 'remove-teenpatti-session',
            socketId,
            userId: session.userId
        });
    }
}
// Table management
function createTeenPattiTable(bootValue, noOfPlayers) {
    // Check if table already exists with same boot value and player count
    for (const table of exports.teenPattiTables.values()) {
        if (table.bootValue === bootValue && table.noOfPlayers === noOfPlayers && table.status === 'waiting') {
            return table;
        }
    }
    const table = {
        id: generateTableId(),
        bootValue,
        noOfPlayers,
        status: 'waiting',
        players: [],
        createdAt: Date.now(),
        waitingPlayers: []
    };
    exports.teenPattiTables.set(table.id, table);
    (0, logger_1.logSocket)('info', {
        event: 'create-teenpatti-table',
        tableId: table.id,
        bootValue,
        noOfPlayers
    });
    return table;
}
function findTeenPattiTable(bootValue, noOfPlayers) {
    for (const table of exports.teenPattiTables.values()) {
        if (table.bootValue === bootValue &&
            table.noOfPlayers === noOfPlayers &&
            table.status === 'waiting' &&
            table.players.length < table.noOfPlayers) {
            return table;
        }
    }
    return undefined;
}
function getTeenPattiTable(tableId) {
    return exports.teenPattiTables.get(tableId);
}
function removeTeenPattiTable(tableId) {
    const table = exports.teenPattiTables.get(tableId);
    if (table) {
        // Clean up any active games
        if (table.currentGameId) {
            exports.teenPattiGames.delete(table.currentGameId);
        }
        exports.teenPattiTables.delete(tableId);
        (0, logger_1.logSocket)('info', {
            event: 'remove-teenpatti-table',
            tableId
        });
    }
}
// Player management
function joinTeenPattiTable(tableId, userId) {
    const table = exports.teenPattiTables.get(tableId);
    if (!table) {
        return { success: false, message: 'Table not found' };
    }
    if (table.status !== 'waiting') {
        return { success: false, message: 'Table is not accepting players' };
    }
    if (table.players.length >= table.noOfPlayers) {
        return { success: false, message: 'Table is full' };
    }
    // Check if player is already at this table
    const existingPlayer = table.players.find(p => p.userId === userId);
    if (existingPlayer) {
        return {
            success: false,
            message: 'You are already at this table',
            seatNo: existingPlayer.seatNo,
            currentPlayers: table.players.length,
            totalPlayers: table.noOfPlayers,
            canStart: table.players.length >= 2
        };
    }
    // Find available seat
    const availableSeats = Array.from({ length: table.noOfPlayers }, (_, i) => i)
        .filter(seatNo => !table.players.find(p => p.seatNo === seatNo));
    if (availableSeats.length === 0) {
        return { success: false, message: 'No available seats' };
    }
    const seatNo = availableSeats[0];
    const player = {
        userId,
        seatNo,
        isBot: false,
        isConnected: true,
        currentBet: 0,
        hasFolded: false,
        lastAction: 'joined',
        lastActionTime: Date.now(),
        totalBet: 0,
        isSeen: false
    };
    table.players.push(player);
    (0, logger_1.logSocket)('info', {
        event: 'join-teenpatti-table',
        tableId,
        userId,
        seatNo
    });
    return {
        success: true,
        seatNo,
        currentPlayers: table.players.length,
        totalPlayers: table.noOfPlayers,
        canStart: table.players.length >= 2
    };
}
function leaveTeenPattiTable(tableId, userId) {
    const table = exports.teenPattiTables.get(tableId);
    if (!table) {
        return { success: false, message: 'Table not found' };
    }
    const playerIndex = table.players.findIndex(p => p.userId === userId);
    if (playerIndex === -1) {
        return { success: false, message: 'Player not found at table' };
    }
    // Remove player from table
    table.players.splice(playerIndex, 1);
    // If table becomes empty, remove it
    if (table.players.length === 0) {
        removeTeenPattiTable(tableId);
    }
    else if (table.status === 'playing') {
        // Handle player leaving during game
        handlePlayerLeaveDuringGame(table, userId);
    }
    (0, logger_1.logSocket)('info', {
        event: 'leave-teenpatti-table',
        tableId,
        userId
    });
    return { success: true };
}
function handlePlayerLeaveDuringGame(table, userId) {
    // If game is active, handle player disconnection
    if (table.currentGameId) {
        const game = exports.teenPattiGames.get(table.currentGameId);
        if (game) {
            const player = game.players.find(p => p.userId === userId);
            if (player) {
                player.isConnected = false;
                player.hasFolded = true;
                player.lastAction = 'disconnected';
                player.lastActionTime = Date.now();
            }
        }
    }
}
// Game management
function startTeenPattiGame(tableId) {
    const table = exports.teenPattiTables.get(tableId);
    if (!table) {
        return { success: false, message: 'Table not found' };
    }
    if (table.status !== 'waiting') {
        return { success: false, message: 'Table is not ready to start' };
    }
    if (table.players.length < 2) {
        return { success: false, message: 'Need at least 2 players to start' };
    }
    // Fill remaining seats with bots if needed
    fillTableWithBots(table);
    // Create new game
    const gameId = generateGameId();
    const dealer = Math.floor(Math.random() * table.players.length);
    const game = {
        id: gameId,
        tableId,
        phase: 'waiting',
        players: table.players.map(p => ({ ...p, cards: undefined, currentBet: 0, hasFolded: false, isSeen: false })),
        currentTurn: 0,
        pot: 0,
        deck: buildTeenPattiDeck(),
        roundNumber: 1,
        dealer,
        lastAction: null,
        bettingRound: 1,
        minBet: parseInt(table.bootValue),
        currentBet: parseInt(table.bootValue),
        lastRaise: parseInt(table.bootValue),
        roundStartTime: Date.now(),
        turnTimeout: 30000 // 30 seconds per turn
    };
    // Update table status
    table.status = 'playing';
    table.currentGameId = gameId;
    // Store game
    exports.teenPattiGames.set(gameId, game);
    // Start the game
    startGameRound(game);
    (0, logger_1.logSocket)('info', {
        event: 'start-teenpatti-game',
        tableId,
        gameId,
        playerCount: game.players.length
    });
    return {
        success: true,
        gameId,
        players: game.players,
        dealer,
        bootValue: table.bootValue
    };
}
function fillTableWithBots(table) {
    while (table.players.length < table.noOfPlayers) {
        const botId = generateBotId();
        const seatNo = table.players.length;
        const bot = {
            userId: botId,
            seatNo,
            isBot: true,
            isConnected: true,
            currentBet: 0,
            hasFolded: false,
            lastAction: 'joined',
            lastActionTime: Date.now(),
            totalBet: 0,
            isSeen: false
        };
        table.players.push(bot);
        (0, logger_1.logSocket)('info', {
            event: 'add-teenpatti-bot',
            tableId: table.id,
            botId,
            seatNo
        });
    }
}
function buildTeenPattiDeck() {
    const suits = ['H', 'D', 'C', 'S'];
    const ranks = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12', '13'];
    const deck = [];
    for (const suit of suits) {
        for (const rank of ranks) {
            deck.push(`${suit}${rank}`);
        }
    }
    // Shuffle deck
    for (let i = deck.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [deck[i], deck[j]] = [deck[j], deck[i]];
    }
    return deck;
}
function startGameRound(game) {
    game.phase = 'dealing';
    // Deal 3 cards to each player
    game.players.forEach((player, index) => {
        const cards = [];
        for (let i = 0; i < 3; i++) {
            if (game.deck.length > 0) {
                cards.push(game.deck.pop());
            }
        }
        player.cards = cards;
    });
    // Set initial pot (boot value from all players)
    game.pot = game.players.length * game.minBet;
    game.players.forEach(player => {
        player.currentBet = game.minBet;
        player.totalBet = game.minBet;
    });
    // Start betting round
    game.phase = 'blind-betting';
    game.currentTurn = (game.dealer + 1) % game.players.length;
    game.roundStartTime = Date.now();
    (0, logger_1.logSocket)('info', {
        event: 'teenpatti-round-started',
        gameId: game.id,
        pot: game.pot,
        currentTurn: game.currentTurn
    });
}
function getTeenPattiGame(gameId) {
    return exports.teenPattiGames.get(gameId);
}
function removeTeenPattiGame(gameId) {
    const game = exports.teenPattiGames.get(gameId);
    if (game) {
        // Update table status
        const table = exports.teenPattiTables.get(game.tableId);
        if (table) {
            table.status = 'waiting';
            table.currentGameId = undefined;
        }
        exports.teenPattiGames.delete(gameId);
        (0, logger_1.logSocket)('info', {
            event: 'remove-teenpatti-game',
            gameId
        });
    }
}
// Utility functions for external use
function getTeenPattiTablesByBootValue(bootValue) {
    return Array.from(exports.teenPattiTables.values())
        .filter(table => table.bootValue === bootValue && table.status === 'waiting');
}
function getTeenPattiTablesByPlayerCount(noOfPlayers) {
    return Array.from(exports.teenPattiTables.values())
        .filter(table => table.noOfPlayers === noOfPlayers && table.status === 'waiting');
}
function getTeenPattiTablesByStatus(status) {
    return Array.from(exports.teenPattiTables.values())
        .filter(table => table.status === status);
}
function getTeenPattiPlayerByUserId(tableId, userId) {
    const table = exports.teenPattiTables.get(tableId);
    if (!table)
        return undefined;
    return table.players.find(p => p.userId === userId);
}
function updateTeenPattiPlayerConnection(userId, isConnected) {
    // Update in all tables
    for (const table of exports.teenPattiTables.values()) {
        const player = table.players.find(p => p.userId === userId);
        if (player) {
            player.isConnected = isConnected;
            player.lastSeen = Date.now();
        }
    }
    // Update in all games
    for (const game of exports.teenPattiGames.values()) {
        const player = game.players.find(p => p.userId === userId);
        if (player) {
            player.isConnected = isConnected;
            player.lastSeen = Date.now();
        }
    }
}
// Cleanup functions
function cleanupTeenPattiState() {
    const now = Date.now();
    const TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
    // Clean up disconnected sessions
    for (const [socketId, session] of exports.teenPattiSessions.entries()) {
        if (now - session.lastSeen > TIMEOUT_MS) {
            removeTeenPattiSession(socketId);
        }
    }
    // Clean up empty tables
    for (const [tableId, table] of exports.teenPattiTables.entries()) {
        if (table.players.length === 0 && now - table.createdAt > TIMEOUT_MS) {
            removeTeenPattiTable(tableId);
        }
    }
    // Clean up finished games
    for (const [gameId, game] of exports.teenPattiGames.entries()) {
        if (game.phase === 'finished' && now - game.roundStartTime > TIMEOUT_MS) {
            removeTeenPattiGame(gameId);
        }
    }
}
// Turn timer management
const turnTimers = new Map();
function startTurnTimer(gameId, playerId, timeoutMs = 30000) {
    // Clear existing timer
    clearTurnTimer(gameId);
    const timer = setTimeout(() => {
        const game = exports.teenPattiGames.get(gameId);
        if (!game || game.phase === 'finished')
            return;
        const player = game.players.find(p => p.userId === playerId);
        if (!player || player.hasFolded)
            return;
        // Auto-pack player if they don't act in time
        processPackAction(game.tableId, playerId);
        (0, logger_1.logSocket)('info', {
            event: 'turn-timeout',
            gameId,
            playerId,
            action: 'auto-pack'
        });
    }, timeoutMs);
    turnTimers.set(gameId, timer);
}
function clearTurnTimer(gameId) {
    const timer = turnTimers.get(gameId);
    if (timer) {
        clearTimeout(timer);
        turnTimers.delete(gameId);
    }
}
// Set up periodic cleanup
setInterval(cleanupTeenPattiState, 60000); // Run every minute
setInterval(cleanupEmptyTables, 120000); // Run every 2 minutes
// Betting action processing functions
function processBetAction(tableId, userId, action, amount, targetPlayerId) {
    const game = exports.teenPattiGames.get(tableId);
    if (!game) {
        return { success: false, message: 'Game not found' };
    }
    const player = game.players.find(p => p.userId === userId);
    if (!player) {
        return { success: false, message: 'Player not found in game' };
    }
    if (player.hasFolded) {
        return { success: false, message: 'Player has already folded' };
    }
    if (game.currentTurn !== player.seatNo) {
        return { success: false, message: 'Not your turn' };
    }
    if (!['blind-betting', 'seen-betting'].includes(game.phase)) {
        return { success: false, message: 'Betting is not allowed in current phase' };
    }
    // Process the action
    try {
        let betAmount = 0;
        if (action === 'call') {
            // Calculate call amount based on current bet and player's bet
            const currentBet = game.currentBet;
            const playerBet = player.currentBet;
            betAmount = currentBet - playerBet;
            if (betAmount <= 0) {
                return { success: false, message: 'Nothing to call' };
            }
        }
        else if (action === 'raise') {
            if (!amount || amount <= game.currentBet) {
                return { success: false, message: 'Raise amount must be higher than current bet' };
            }
            const playerBet = player.currentBet;
            betAmount = amount - playerBet;
            game.currentBet = amount;
            game.lastRaise = amount;
        }
        // Update player bet and pot
        player.currentBet += betAmount;
        player.totalBet += betAmount;
        player.lastAction = action;
        player.lastActionTime = Date.now();
        // If player sees their cards during betting, they become "seen"
        if (!player.isSeen && Math.random() > 0.3) { // 70% chance to see cards
            player.isSeen = true;
            if (game.phase === 'blind-betting') {
                game.phase = 'seen-betting';
            }
        }
        game.pot += betAmount;
        // Move to next active player
        const nextTurn = getNextActiveTurn(game);
        game.currentTurn = nextTurn;
        // Check if betting round should end
        const activePlayers = game.players.filter(p => !p.hasFolded);
        const canShow = activePlayers.length === 2 && activePlayers.some(p => p.isSeen);
        (0, logger_1.logSocket)('info', {
            event: 'bet-processed',
            gameId: game.id,
            userId,
            action,
            amount: betAmount,
            newPot: game.pot,
            nextTurn
        });
        return {
            success: true,
            newPot: game.pot,
            nextTurn,
            gamePhase: game.phase,
            canShow
        };
    }
    catch (error) {
        (0, logger_1.logSocket)('error', {
            event: 'bet-processing-error',
            gameId: game.id,
            userId,
            error: error instanceof Error ? error.message : String(error)
        });
        return { success: false, message: 'Error processing bet' };
    }
}
function processShowAction(tableId, userId, targetPlayerId) {
    const game = exports.teenPattiGames.get(tableId);
    if (!game) {
        return { success: false, message: 'Game not found' };
    }
    const player = game.players.find(p => p.userId === userId);
    if (!player) {
        return { success: false, message: 'Player not found in game' };
    }
    if (player.hasFolded) {
        return { success: false, message: 'Player has already folded' };
    }
    const activePlayers = game.players.filter(p => !p.hasFolded);
    if (activePlayers.length !== 2) {
        return { success: false, message: 'Show only allowed when 2 players remain' };
    }
    // If target not specified, use the other active player
    const targetPlayer = targetPlayerId
        ? game.players.find(p => p.userId === targetPlayerId)
        : activePlayers.find(p => p.userId !== userId);
    if (!targetPlayer || targetPlayer.hasFolded) {
        return { success: false, message: 'Invalid target player' };
    }
    // Determine winner
    const hands = [
        { playerId: userId, cards: player.cards || [] },
        { playerId: targetPlayer.userId, cards: targetPlayer.cards || [] }
    ];
    const winners = (0, teenpatti_rules_1.getTeenPattiWinner)(hands);
    const winnerUserId = winners[0] || userId; // Fallback to challenger
    // Calculate winnings
    const { winnings } = (0, teenpatti_rules_1.calculateTeenPattiWinnings)(winners, game.pot, 0); // No rake for now
    // End the game
    game.phase = 'finished';
    (0, logger_1.logSocket)('info', {
        event: 'show-processed',
        gameId: game.id,
        challenger: userId,
        target: targetPlayer.userId,
        winner: winnerUserId,
        pot: game.pot
    });
    return {
        success: true,
        winner: winnerUserId,
        hands: {
            [userId]: player.cards || [],
            [targetPlayer.userId]: targetPlayer.cards || []
        },
        winnings
    };
}
function processPackAction(tableId, userId) {
    const game = exports.teenPattiGames.get(tableId);
    if (!game) {
        return { success: false, message: 'Game not found' };
    }
    const player = game.players.find(p => p.userId === userId);
    if (!player) {
        return { success: false, message: 'Player not found in game' };
    }
    if (player.hasFolded) {
        return { success: false, message: 'Player has already folded' };
    }
    // Fold the player
    player.hasFolded = true;
    player.lastAction = 'pack';
    player.lastActionTime = Date.now();
    const activePlayers = game.players.filter(p => !p.hasFolded);
    // Check if game ended
    if (activePlayers.length === 1) {
        // Only one player left, they win
        const winner = activePlayers[0];
        const winnings = { [winner.userId]: game.pot };
        game.phase = 'finished';
        (0, logger_1.logSocket)('info', {
            event: 'pack-game-ended',
            gameId: game.id,
            userId,
            winner: winner.userId,
            pot: game.pot
        });
        return {
            success: true,
            activePlayers: activePlayers.length,
            gameEnded: true,
            winner: winner.userId,
            winnings
        };
    }
    // Move to next active player
    const nextTurn = getNextActiveTurn(game);
    game.currentTurn = nextTurn;
    (0, logger_1.logSocket)('info', {
        event: 'pack-processed',
        gameId: game.id,
        userId,
        activePlayers: activePlayers.length,
        nextTurn
    });
    return {
        success: true,
        nextTurn,
        activePlayers: activePlayers.length,
        gameEnded: false
    };
}
function getNextActiveTurn(game) {
    const activePlayers = game.players.filter(p => !p.hasFolded);
    if (activePlayers.length === 0)
        return 0;
    let nextSeat = (game.currentTurn + 1) % game.players.length;
    // Find next active player
    while (game.players[nextSeat].hasFolded) {
        nextSeat = (nextSeat + 1) % game.players.length;
    }
    return nextSeat;
}
// Public table management
function getPublicTables(bootValue, noOfPlayers) {
    const tables = Array.from(exports.teenPattiTables.values());
    let filtered = tables.filter(table => table.status === 'waiting');
    if (bootValue) {
        filtered = filtered.filter(table => table.bootValue === bootValue);
    }
    if (noOfPlayers) {
        filtered = filtered.filter(table => table.noOfPlayers === noOfPlayers);
    }
    return filtered.sort((a, b) => {
        // Prioritize tables with more players
        if (a.players.length !== b.players.length) {
            return b.players.length - a.players.length;
        }
        // Then by creation time (newer first)
        return b.createdAt - a.createdAt;
    });
}
function findBestTable(bootValue, noOfPlayers) {
    const availableTables = getPublicTables(bootValue, noOfPlayers);
    // First, try to find a table with exact player count
    let bestTable = availableTables.find(table => table.noOfPlayers === noOfPlayers &&
        table.players.length < table.noOfPlayers);
    if (bestTable)
        return bestTable;
    // If no exact match, find any table with the same boot value
    bestTable = availableTables.find(table => table.bootValue === bootValue &&
        table.players.length < table.noOfPlayers);
    if (bestTable)
        return bestTable;
    // If still no match, create a new table
    return createTeenPattiTable(bootValue, noOfPlayers);
}
function getTableStats() {
    const tables = Array.from(exports.teenPattiTables.values());
    const games = Array.from(exports.teenPattiGames.values());
    return {
        totalTables: tables.length,
        waitingTables: tables.filter(t => t.status === 'waiting').length,
        playingTables: tables.filter(t => t.status === 'playing').length,
        totalPlayers: tables.reduce((sum, t) => sum + t.players.length, 0),
        activeGames: games.filter(g => g.phase !== 'finished').length,
    };
}
function cleanupEmptyTables() {
    const now = Date.now();
    const emptyTables = Array.from(exports.teenPattiTables.values()).filter(table => {
        // Remove tables that have been empty for more than 5 minutes
        if (table.players.length === 0 && (now - table.createdAt) > 300000) {
            return true;
        }
        // Remove finished tables that have been inactive for more than 2 minutes
        if (table.status === 'finished' && (now - table.createdAt) > 120000) {
            return true;
        }
        return false;
    });
    emptyTables.forEach(table => {
        removeTeenPattiTable(table.id);
    });
    if (emptyTables.length > 0) {
        (0, logger_1.logSocket)('info', {
            event: 'cleanup-empty-tables',
            removedCount: emptyTables.length,
        });
    }
}
