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

export const WalletLedgerModel = mongoose.models.WalletLedger || mongoose.model<WalletLedgerDoc>('WalletLedger', walletLedgerSchema);

