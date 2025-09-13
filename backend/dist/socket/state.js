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
const config_1 = require("../config");
const rules_config_1 = require("./rules.config");
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
            // Only add one joker per deck copy instead of two
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
    const enabled = (process.env.WILD_RANK_ENABLED ?? '1') !== '0';
    if (!enabled)
        return undefined;
    // Test hook: fixed wild rank
    if ((process.env.NODE_ENV || '').toLowerCase() === 'test' && process.env.TEST_WILD_RANK) {
        const r = String(process.env.TEST_WILD_RANK).toUpperCase();
        if (['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'].includes(r))
            return r;
    }
    const ranksNoA = RANKS; // allow 'A' as 1 as well; client maps to 1
    return ranksNoA[Math.floor(Math.random() * ranksNoA.length)];
}
function createOrFindTable(bootValue, noOfPlayers, format = 'points') {
    // Try to find an existing waiting table with same config and space
    for (const t of exports.waitingTables.values()) {
        if (t.status === 'waiting' &&
            t.bootValue === bootValue &&
            t.noOfPlayers === noOfPlayers &&
            (t.format || 'points') === format &&
            t.players.filter(Boolean).length < t.noOfPlayers) {
            return t;
        }
    }
    const id = (0, crypto_1.randomUUID)();
    const cfg = (0, config_1.loadConfig)();
    const defaultPoint = (0, rules_config_1.loadRulesConfig)().pointValue || cfg.pointValue;
    const table = {
        id,
        bootValue,
        noOfPlayers,
        status: 'waiting',
        players: Array(noOfPlayers).fill(''),
        createdAt: Date.now(),
        pointValue: defaultPoint,
        format,
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
    // Build deck with optional test override
    let deck;
    if ((process.env.NODE_ENV || '').toLowerCase() === 'test' && process.env.TEST_FIXED_DECK) {
        const parts = String(process.env.TEST_FIXED_DECK)
            .split(',')
            .map((s) => s.trim().toUpperCase())
            .filter(Boolean);
        deck = parts;
    }
    else {
        deck = buildDeck(true, true); // Double deck with reduced jokers
    }
    const cardsPerPlayer = 13;
    // Toss for seating order: draw one card per player, highest rank first (Ace high)
    // Phase: toss
    const rankOrder = { 'A': 14, 'K': 13, 'Q': 12, 'J': 11 };
    const suitPriority = { RP: 4, BP: 3, BL: 2, RS: 1 }; // hearts > spades > clubs > diamonds
    const joinOrder = [...activePlayers];
    let orderedPlayers = [];
    let winnerSeat = 0;
    let drawForTossTop;
    let drawForTossBottom;
    const cardsByUser = {};
    if ((process.env.TOSS_JOIN_ORDER ?? '0') === '1') {
        orderedPlayers = [...joinOrder];
        winnerSeat = 0;
    }
    else {
        const tossDraws = [];
        const tossDeck = buildDeck(false, false);
        for (let p = 0; p < activePlayers.length; p++) {
            const tossCard = tossDeck.shift();
            const suit = tossCard.slice(0, 2).toUpperCase();
            const r = tossCard.slice(2).toUpperCase();
            const base = rankOrder[r] || Number(r) || 0;
            const val = base * 10 + (suitPriority[suit] || 0); // tie-break by suit priority
            tossDraws.push({ uid: activePlayers[p], card: tossCard, value: val });
        }
        tossDraws.sort((a, b) => b.value - a.value);
        orderedPlayers = tossDraws.map(t => t.uid);
        winnerSeat = 0;
        drawForTossTop = tossDraws[0]?.card;
        drawForTossBottom = tossDraws[1]?.card || drawForTossTop;
        for (const t of tossDraws)
            cardsByUser[t.uid] = t.card;
    }
    // Phase: dealing with optional fixed hands per seat in tests
    const playersHands = orderedPlayers.map(() => []);
    if ((process.env.NODE_ENV || '').toLowerCase() === 'test') {
        for (let p = 0; p < orderedPlayers.length; p++) {
            const envKey = `TEST_HAND_S${p}`;
            const val = process.env[envKey];
            if (val && typeof val === 'string' && val.trim().length > 0) {
                const codes = val.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);
                for (const c of codes) {
                    const idx = deck.indexOf(c);
                    if (idx >= 0)
                        deck.splice(idx, 1);
                }
                playersHands[p] = codes.slice(0, cardsPerPlayer);
            }
        }
    }
    // Deal remaining cards up to cardsPerPlayer
    for (let i = 0; i < cardsPerPlayer; i++) {
        for (let p = 0; p < orderedPlayers.length; p++) {
            if ((playersHands[p] || []).length > i)
                continue;
            const card = deck.shift();
            if (card)
                playersHands[p].push(card);
        }
    }
    const wildCardRank = chooseWildRank();
    // Place initial open card on discard pile
    const initialDiscard = deck.shift() || undefined;
    const game = {
        id: gameId,
        tableId: table.id,
        players: [...orderedPlayers],
        deck,
        discardPile: initialDiscard ? [initialDiscard] : [],
        playersHands,
        playersGroups: orderedPlayers.map(() => []),
        wildCardRank,
        currentTurn: winnerSeat,
        startedAt: Date.now(),
        turnDeadline: undefined,
        drawnThisTurn: orderedPlayers.map(() => false),
        hasPlayedAnyTurn: orderedPlayers.map(() => false),
        packed: orderedPlayers.map(() => false),
        toss: { winnerSeat, winnerUserId: orderedPlayers[winnerSeat], topCard: drawForTossTop, bottomCard: drawForTossBottom, cardsByUser, order: joinOrder },
        pointValue: table.pointValue || Number(process.env.POINT_VALUE || 1),
        lastDrawnCard: orderedPlayers.map(() => null),
        lastDrawnFrom: orderedPlayers.map(() => null),
        phase: 'started',
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
    // Accept already-encoded card codes (e.g., 'RP7', 'BL10', 'JKR1')
    if (typeof card === 'string') {
        const s = String(card).toUpperCase();
        if (s.startsWith('JKR'))
            return s;
        const suit = s.slice(0, 2);
        const rank = s.slice(2);
        if (['RP', 'BP', 'BL', 'RS'].includes(suit) && ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'].includes(rank)) {
            return s;
        }
        return null;
    }
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
