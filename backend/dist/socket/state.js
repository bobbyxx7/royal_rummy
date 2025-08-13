"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TABLE_ROOM = exports.games = exports.waitingTables = exports.userIdToSocket = exports.sessions = void 0;
exports.buildDeck = buildDeck;
exports.shuffle = shuffle;
exports.chooseWildRank = chooseWildRank;
exports.createOrFindTable = createOrFindTable;
exports.joinTable = joinTable;
exports.startGameForTable = startGameForTable;
exports.findSessionBySocket = findSessionBySocket;
exports.clientCardToCode = clientCardToCode;
const crypto_1 = require("crypto");
exports.sessions = new Map(); // socketId -> session
exports.userIdToSocket = new Map();
exports.waitingTables = new Map(); // tableId -> table
exports.games = new Map();
const TABLE_ROOM = (tableId) => `table:${tableId}`;
exports.TABLE_ROOM = TABLE_ROOM;
const SUITS = ['RP', 'BP', 'BL', 'RS'];
const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
function buildDeck(doubleDeck = true, includeJokers = true) {
    const deck = [];
    const copies = doubleDeck ? 2 : 1;
    for (let c = 0; c < copies; c++) {
        for (const s of SUITS) {
            for (const r of RANKS) {
                deck.push(`${s}${r}`);
            }
        }
        if (includeJokers) {
            deck.push('JKR1');
            deck.push('JKR2');
        }
    }
    return shuffle(deck);
}
function shuffle(arr) {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}
function chooseWildRank() {
    const ranksNoA = RANKS; // allow 'A' as 1 as well; client maps to 1
    return ranksNoA[Math.floor(Math.random() * ranksNoA.length)];
}
function createOrFindTable(bootValue, noOfPlayers) {
    // Try to find an existing waiting table with same config and space
    for (const t of exports.waitingTables.values()) {
        if (t.status === 'waiting' &&
            t.bootValue === bootValue &&
            t.noOfPlayers === noOfPlayers &&
            t.players.filter(Boolean).length < t.noOfPlayers) {
            return t;
        }
    }
    const id = (0, crypto_1.randomUUID)();
    const table = {
        id,
        bootValue,
        noOfPlayers,
        status: 'waiting',
        players: Array(noOfPlayers).fill(''),
        createdAt: Date.now(),
    };
    exports.waitingTables.set(id, table);
    return table;
}
function joinTable(table, userId) {
    // Prevent same user joining twice
    if (table.players.includes(userId)) {
        return { seatNo: table.players.indexOf(userId) };
    }
    const seat = table.players.findIndex((u) => !u);
    if (seat === -1)
        return null;
    table.players[seat] = userId;
    return { seatNo: seat };
}
function startGameForTable(table) {
    const activePlayers = table.players.filter(Boolean);
    const gameId = (0, crypto_1.randomUUID)();
    const deck = buildDeck(true, true);
    const playersHands = activePlayers.map(() => []);
    const cardsPerPlayer = 13;
    for (let i = 0; i < cardsPerPlayer; i++) {
        for (let p = 0; p < activePlayers.length; p++) {
            const card = deck.shift();
            if (card)
                playersHands[p].push(card);
        }
    }
    const wildCardRank = chooseWildRank();
    const game = {
        id: gameId,
        tableId: table.id,
        players: [...table.players],
        deck,
        discardPile: [],
        playersHands,
        wildCardRank,
        currentTurn: 0,
        startedAt: Date.now(),
    };
    exports.games.set(gameId, game);
    table.status = 'playing';
    return game;
}
function findSessionBySocket(socketId) {
    return exports.sessions.get(socketId);
}
const suitToCode = {
    hearts: 'RP',
    spades: 'BP',
    clubs: 'BL',
    diamonds: 'RS',
};
function clientCardToCode(card) {
    if (!card)
        return null;
    if (card.isJoker)
        return 'JKR1';
    const suit = suitToCode[String(card.suit || '').toLowerCase()];
    if (!suit)
        return null;
    let rankStr = String(card.rank || '').toUpperCase();
    // strip wild suffix
    if (rankStr.endsWith('J'))
        rankStr = rankStr.substring(0, rankStr.length - 1);
    // normalize Ace and face cards
    if (rankStr === '1')
        rankStr = 'A';
    if (rankStr === '11')
        rankStr = 'J';
    if (rankStr === '12')
        rankStr = 'Q';
    if (rankStr === '13')
        rankStr = 'K';
    return `${suit}${rankStr}`;
}
