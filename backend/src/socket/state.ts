import { randomUUID } from 'crypto';
import { loadConfig } from '../config';
import { loadRulesConfig } from './rules.config';

export type SuitCode = 'RP' | 'BP' | 'BL' | 'RS';
export type RankCode = 'A' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '10' | 'J' | 'Q' | 'K';
export type CardCode = string; // e.g., 'RP7', 'BLQ', 'RS10', 'JKR1'

export type UserSession = {
  socketId: string;
  userId: string;
  token?: string;
  tableId?: string;
  gameId?: string;
  seatNo?: number;
};

export type Table = {
  id: string;
  bootValue: string;
  noOfPlayers: number;
  status: 'waiting' | 'playing';
  players: string[]; // userIds by seat index
  createdAt: number;
  pointValue?: number; // per-point value for Points Rummy
  format?: 'points' | 'deals' | 'pool';
};

export type Game = {
  id: string;
  tableId: string;
  players: string[]; // userIds by seat index
  deck: CardCode[];
  discardPile: CardCode[];
  playersHands: CardCode[][];
  playersGroups: CardCode[][][]; // per seat: array of groups of card codes (UI arrangement)
  wildCardRank?: RankCode;
  wildCardFace?: CardCode; // face-up indicator card drawn from deck for wild determination
  currentTurn: number; // seat index
  startedAt: number;
  turnDeadline?: number; // epoch ms when the current turn ends
  drawnThisTurn: boolean[]; // per seat: has drawn a card this turn
  toss?: { winnerSeat: number; winnerUserId: string; topCard?: CardCode; bottomCard?: CardCode; cardsByUser?: Record<string, CardCode>; order?: string[] };
  hasPlayedAnyTurn: boolean[]; // per seat: has completed at least one draw+discard cycle
  packed: boolean[]; // per seat: has packed
  pointValue: number; // per-point value used for settlement
  lastDrawnCard: (CardCode | null)[]; // per seat: last drawn card
  lastDrawnFrom: ("closed" | "open" | null)[]; // per seat: source of last draw
  phase: 'toss' | 'dealing' | 'started' | 'completed';
};

export const sessions = new Map<string, UserSession>(); // socketId -> session
export const userIdToSocket = new Map<string, string>();
export const waitingTables = new Map<string, Table>(); // tableId -> table
export const games = new Map<string, Game>();

export const TABLE_ROOM = (tableId: string) => `table:${tableId}`;

const SUITS: SuitCode[] = ['RP', 'BP', 'BL', 'RS'];
const RANKS: RankCode[] = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];

export function buildDeck(doubleDeck = true, includeJokers = true): CardCode[] {
  const deck: CardCode[] = [];
  const copies = doubleDeck ? 2 : 1;
  for (let c = 0; c < copies; c++) {
    for (const s of SUITS) {
      for (const r of RANKS) {
        deck.push(`${s}${r}`);
      }
    }
    if (includeJokers) {
      // Add two printed jokers per deck copy (standard rummy decks)
      deck.push('JKR1');
      deck.push('JKR1');
    }
  }
  return shuffle(deck);
}

export function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function chooseWildRank(): RankCode | undefined {
  const enabled = (process.env.WILD_RANK_ENABLED ?? '1') !== '0';
  if (!enabled) return undefined;
  // Test hook: fixed wild rank
  if ((process.env.NODE_ENV || '').toLowerCase() === 'test' && process.env.TEST_WILD_RANK) {
    const r = String(process.env.TEST_WILD_RANK).toUpperCase();
    if (['A','2','3','4','5','6','7','8','9','10','J','Q','K'].includes(r)) return r as RankCode;
  }
  const ranksNoA = RANKS; // allow 'A' as 1 as well; client maps to 1
  return ranksNoA[Math.floor(Math.random() * ranksNoA.length)];
}

export function createOrFindTable(bootValue: string, noOfPlayers: number, format: 'points' | 'deals' | 'pool' = 'points'): Table {
  // Try to find an existing waiting table with same config and space
  for (const t of waitingTables.values()) {
    if (
      t.status === 'waiting' &&
      t.bootValue === bootValue &&
      t.noOfPlayers === noOfPlayers &&
      (t.format || 'points') === format &&
      t.players.filter(Boolean).length < t.noOfPlayers
    ) {
      return t;
    }
  }
  const id = randomUUID();
  const cfg = loadConfig();
  const defaultPoint = loadRulesConfig().pointValue || cfg.pointValue;
  const table: Table = {
    id,
    bootValue,
    noOfPlayers,
    status: 'waiting',
    players: Array(noOfPlayers).fill(''),
    createdAt: Date.now(),
    pointValue: defaultPoint,
    format,
  };
  waitingTables.set(id, table);
  return table;
}

export function joinTable(table: Table, userId: string): { seatNo: number } | null {
  // Prevent same user joining twice
  if (table.players.includes(userId)) {
    return { seatNo: table.players.indexOf(userId) };
  }
  const seat = table.players.findIndex((u) => !u);
  if (seat === -1) return null;
  table.players[seat] = userId;
  return { seatNo: seat };
}

export function startGameForTable(table: Table): Game {
  const activePlayers = table.players.filter(Boolean);
  const gameId = randomUUID();
  // Build deck with optional test override
  let deck: CardCode[];
  if ((process.env.NODE_ENV || '').toLowerCase() === 'test' && process.env.TEST_FIXED_DECK) {
    const parts = String(process.env.TEST_FIXED_DECK)
      .split(',')
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean);
    deck = parts as CardCode[];
  } else {
    deck = buildDeck(true, true); // Double deck with reduced jokers
  }
  const cardsPerPlayer = 13;

  // Toss for seating order: draw one card per player, highest rank first (Ace high)
  // Phase: toss
  const rankOrder: Record<string, number> = { 'A': 14, 'K': 13, 'Q': 12, 'J': 11 };
  const suitPriority: Record<SuitCode, number> = { RP: 4, BP: 3, BL: 2, RS: 1 }; // hearts > spades > clubs > diamonds
  const joinOrder = [...activePlayers];
  let orderedPlayers: string[] = [];
  let winnerSeat = 0;
  let drawForTossTop: CardCode | undefined;
  let drawForTossBottom: CardCode | undefined;
  const cardsByUser: Record<string, CardCode> = {};
  if ((process.env.TOSS_JOIN_ORDER ?? '0') === '1') {
    orderedPlayers = [...joinOrder];
    winnerSeat = 0;
  } else {
    const tossDraws: { uid: string; card: CardCode; value: number }[] = [];
    const tossDeck = buildDeck(false, false);
    for (let p = 0; p < activePlayers.length; p++) {
      const tossCard = tossDeck.shift()!;
      const suit = tossCard.slice(0, 2).toUpperCase() as SuitCode;
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
    for (const t of tossDraws) cardsByUser[t.uid] = t.card;
  }

  // Phase: dealing with optional fixed hands per seat in tests
  const playersHands: CardCode[][] = orderedPlayers.map(() => []);
  if ((process.env.NODE_ENV || '').toLowerCase() === 'test') {
    for (let p = 0; p < orderedPlayers.length; p++) {
      const envKey = `TEST_HAND_S${p}`;
      const val = (process.env as any)[envKey];
      if (val && typeof val === 'string' && val.trim().length > 0) {
        const codes = val.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);
        for (const c of codes) {
          const idx = deck.indexOf(c);
          if (idx >= 0) deck.splice(idx, 1);
        }
        playersHands[p] = codes.slice(0, cardsPerPlayer) as CardCode[];
      }
    }
  }
  // Deal remaining cards up to cardsPerPlayer
  for (let i = 0; i < cardsPerPlayer; i++) {
    for (let p = 0; p < orderedPlayers.length; p++) {
      if ((playersHands[p] || []).length > i) continue;
      const card = deck.shift();
      if (card) playersHands[p].push(card);
    }
  }

  // Draw a face card to determine wild rank (visible indicator card)
  const wildCardFace = deck.shift();
  let wildCardRank: RankCode | undefined = undefined;
  try {
    if (wildCardFace) {
      const r = wildCardFace.slice(2).toUpperCase();
      const isValid = (['A','2','3','4','5','6','7','8','9','10','J','Q','K'] as RankCode[]).includes(r as RankCode);
      wildCardRank = isValid ? (r as RankCode) : chooseWildRank();
    } else {
      wildCardRank = chooseWildRank();
    }
  } catch {
    wildCardRank = chooseWildRank();
  }

  // Place initial open card on discard pile from remaining deck
  const initialDiscard = deck.shift() || undefined;

  const game: Game = {
    id: gameId,
    tableId: table.id,
    players: [...orderedPlayers],
    deck,
    discardPile: initialDiscard ? [initialDiscard] : [],
    playersHands,
    playersGroups: orderedPlayers.map(() => []),
    wildCardRank,
    wildCardFace: wildCardFace || undefined,
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
  games.set(gameId, game);
  table.status = 'playing';
  return game;
}

export function findSessionBySocket(socketId: string): UserSession | undefined {
  return sessions.get(socketId);
}

const suitToCode: Record<string, SuitCode> = {
  hearts: 'RP',
  spades: 'BP',
  clubs: 'BL',
  diamonds: 'RS',
};

export function clientCardToCode(card: any): CardCode | null {
  if (!card) return null;
  // Accept already-encoded card codes (e.g., 'RP7', 'BL10', 'JKR1')
  if (typeof card === 'string') {
    const s = String(card).toUpperCase();
    if (s.startsWith('JKR')) return s;
    const suit = s.slice(0, 2);
    const rank = s.slice(2);
    if (['RP', 'BP', 'BL', 'RS'].includes(suit) && ['A','2','3','4','5','6','7','8','9','10','J','Q','K'].includes(rank)) {
      return s as CardCode;
    }
    return null;
  }
  if (card.isJoker) return 'JKR1';
  const suit: SuitCode | undefined = suitToCode[String(card.suit || '').toLowerCase()];
  if (!suit) return null;
  let rankStr: string = String(card.rank || '').toUpperCase();
  // strip wild suffix
  if (rankStr.endsWith('J')) rankStr = rankStr.substring(0, rankStr.length - 1);
  // normalize Ace and face cards
  if (rankStr === '1') rankStr = 'A';
  if (rankStr === '11') rankStr = 'J';
  if (rankStr === '12') rankStr = 'Q';
  if (rankStr === '13') rankStr = 'K';
  return `${suit}${rankStr}`;
}


