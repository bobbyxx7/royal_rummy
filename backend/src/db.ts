import mongoose from 'mongoose';

export async function connectMongo(uri: string) {
  if (mongoose.connection.readyState === 1) return;
  await mongoose.connect(uri, { dbName: process.env.MONGO_DB || 'rummy' });
}

export type UserDoc = mongoose.Document & {
  name: string;
  mobile: string;
  passwordHash: string;
  gender?: string;
  referral_code?: string;
  user_type?: string;
  wallet: string;
  token: string;
};

const userSchema = new mongoose.Schema<UserDoc>({
  name: { type: String, default: '' },
  mobile: { type: String, index: true, unique: true },
  passwordHash: { type: String, required: true },
  gender: String,
  referral_code: String,
  user_type: String,
  wallet: { type: String, default: '0' },
  token: { type: String, index: true },
}, { timestamps: true });

export const UserModel = mongoose.models.User || mongoose.model<UserDoc>('User', userSchema);

// Round result snapshot for auditing and history
export type RoundPoint = { user_id: string; seat: number; points: number; delta: number };

export type RoundResultDoc = mongoose.Document & {
  tableId: string;
  gameId: string;
  pointValue: number;
  winnerUserId: string;
  points: RoundPoint[];
  rake?: number;
};

const roundResultSchema = new mongoose.Schema<RoundResultDoc>({
  tableId: { type: String, index: true },
  gameId: { type: String, index: true },
  pointValue: { type: Number },
  winnerUserId: { type: String, index: true },
  points: [{ user_id: String, seat: Number, points: Number, delta: Number }],
  rake: { type: Number, default: 0 },
}, { timestamps: true });

// Compound index for common admin queries
roundResultSchema.index({ tableId: 1, winnerUserId: 1, createdAt: -1 });

export const RoundResultModel = mongoose.models.RoundResult || mongoose.model<RoundResultDoc>('RoundResult', roundResultSchema);

// Wallet ledger for auditable balance changes
export type WalletLedgerDoc = mongoose.Document & {
  userId: string;
  delta: number;
  reason: string;
  ref?: string;
  balanceAfter?: string;
};

const walletLedgerSchema = new mongoose.Schema<WalletLedgerDoc>({
  userId: { type: String, index: true },
  delta: { type: Number },
  reason: { type: String },
  ref: { type: String },
  balanceAfter: { type: String },
}, { timestamps: true });

// Index for reconciliation/time-ordered lookups
walletLedgerSchema.index({ userId: 1, createdAt: -1 });

export const WalletLedgerModel = mongoose.models.WalletLedger || mongoose.model<WalletLedgerDoc>('WalletLedger', walletLedgerSchema);

// Wallet holds (e.g., boot holds for deals/tables)
export type WalletHoldDoc = mongoose.Document & {
  userId: string;
  tableId: string;
  gameId?: string;
  amount: number;
  reason: string;
  active: boolean;
};

const walletHoldSchema = new mongoose.Schema<WalletHoldDoc>({
  userId: { type: String, index: true },
  tableId: { type: String, index: true },
  gameId: { type: String },
  amount: { type: Number },
  reason: { type: String },
  active: { type: Boolean, default: true, index: true },
}, { timestamps: true });

// Index to quickly find active holds per user/table
walletHoldSchema.index({ userId: 1, tableId: 1, active: 1 });

export const WalletHoldModel = mongoose.models.WalletHold || mongoose.model<WalletHoldDoc>('WalletHold', walletHoldSchema);

// Minimal persistence for tables and games (snapshots)
export type TableDoc = mongoose.Document & {
  tableId: string;
  bootValue: string;
  noOfPlayers: number;
  status: 'waiting' | 'playing';
  players: string[];
  pointValue: number;
};

const tableSchema = new mongoose.Schema<TableDoc>({
  tableId: { type: String, index: true, unique: true },
  bootValue: String,
  noOfPlayers: Number,
  status: { type: String },
  players: [String],
  pointValue: Number,
}, { timestamps: true });

export const TableModel = mongoose.models.Table || mongoose.model<TableDoc>('Table', tableSchema);

export type GameDoc = mongoose.Document & {
  gameId: string;
  tableId: string;
  players: string[];
  currentTurn: number;
  phase: string;
  deckCount: number;
  discardTop?: string | null;
  pointValue: number;
  wildCardRank?: string;
  turnDeadline?: number;
};

const gameSchema = new mongoose.Schema<GameDoc>({
  gameId: { type: String, index: true, unique: true },
  tableId: { type: String, index: true },
  players: [String],
  currentTurn: Number,
  phase: String,
  deckCount: Number,
  discardTop: String,
  pointValue: Number,
  wildCardRank: String,
  turnDeadline: Number,
}, { timestamps: true });

export const GameModel = mongoose.models.Game || mongoose.model<GameDoc>('Game', gameSchema);

