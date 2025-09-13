"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.GameModel = exports.TableModel = exports.WalletHoldModel = exports.WalletLedgerModel = exports.RoundResultModel = exports.UserModel = void 0;
exports.connectMongo = connectMongo;
const mongoose_1 = __importDefault(require("mongoose"));
async function connectMongo(uri) {
    if (mongoose_1.default.connection.readyState === 1)
        return;
    await mongoose_1.default.connect(uri, { dbName: process.env.MONGO_DB || 'rummy' });
}
const userSchema = new mongoose_1.default.Schema({
    name: { type: String, default: '' },
    mobile: { type: String, index: true, unique: true },
    passwordHash: { type: String, required: true },
    gender: String,
    referral_code: String,
    user_type: String,
    wallet: { type: String, default: '0' },
    token: { type: String, index: true },
}, { timestamps: true });
exports.UserModel = mongoose_1.default.models.User || mongoose_1.default.model('User', userSchema);
const roundResultSchema = new mongoose_1.default.Schema({
    tableId: { type: String, index: true },
    gameId: { type: String, index: true },
    pointValue: { type: Number },
    winnerUserId: { type: String, index: true },
    points: [{ user_id: String, seat: Number, points: Number, delta: Number }],
    rake: { type: Number, default: 0 },
}, { timestamps: true });
// Compound index for common admin queries
roundResultSchema.index({ tableId: 1, winnerUserId: 1, createdAt: -1 });
exports.RoundResultModel = mongoose_1.default.models.RoundResult || mongoose_1.default.model('RoundResult', roundResultSchema);
const walletLedgerSchema = new mongoose_1.default.Schema({
    userId: { type: String, index: true },
    delta: { type: Number },
    reason: { type: String },
    ref: { type: String },
    balanceAfter: { type: String },
}, { timestamps: true });
// Index for reconciliation/time-ordered lookups
walletLedgerSchema.index({ userId: 1, createdAt: -1 });
exports.WalletLedgerModel = mongoose_1.default.models.WalletLedger || mongoose_1.default.model('WalletLedger', walletLedgerSchema);
const walletHoldSchema = new mongoose_1.default.Schema({
    userId: { type: String, index: true },
    tableId: { type: String, index: true },
    gameId: { type: String },
    amount: { type: Number },
    reason: { type: String },
    active: { type: Boolean, default: true, index: true },
}, { timestamps: true });
// Index to quickly find active holds per user/table
walletHoldSchema.index({ userId: 1, tableId: 1, active: 1 });
exports.WalletHoldModel = mongoose_1.default.models.WalletHold || mongoose_1.default.model('WalletHold', walletHoldSchema);
const tableSchema = new mongoose_1.default.Schema({
    tableId: { type: String, index: true, unique: true },
    bootValue: String,
    noOfPlayers: Number,
    status: { type: String },
    players: [String],
    pointValue: Number,
}, { timestamps: true });
exports.TableModel = mongoose_1.default.models.Table || mongoose_1.default.model('Table', tableSchema);
const gameSchema = new mongoose_1.default.Schema({
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
exports.GameModel = mongoose_1.default.models.Game || mongoose_1.default.model('Game', gameSchema);
