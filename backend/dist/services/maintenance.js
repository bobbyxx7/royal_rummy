"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sweepStaleHolds = sweepStaleHolds;
exports.gcSnapshots = gcSnapshots;
const auth_1 = require("../auth");
const db_1 = require("../db");
const state_1 = require("../socket/state");
/**
 * Release active holds for tables that no longer exist in memory (stale).
 * Returns number of holds released.
 */
async function sweepStaleHolds() {
    if (!(0, auth_1.isDbConnected)())
        return 0;
    const existingTableIds = new Set([
        ...Array.from(state_1.waitingTables.keys()),
        ...Array.from(state_1.games.values()).map((g) => g.tableId),
    ]);
    const holds = await db_1.WalletHoldModel.find({ active: true }).lean().exec().catch(() => []);
    let released = 0;
    for (const h of holds) {
        const tableId = String(h.tableId || '');
        if (!existingTableIds.has(tableId)) {
            const amt = Number(h.amount || 0);
            const userId = String(h.userId || '');
            try {
                await db_1.WalletLedgerModel.create({ userId, delta: amt, reason: 'hold_release', ref: `sweep:${tableId}` });
                await db_1.UserModel.updateOne({ _id: userId }, [{ $set: { wallet: { $toString: { $round: [{ $add: [{ $toDouble: '$wallet' }, amt] }, 2] } } } }]).exec();
                await db_1.WalletHoldModel.updateOne({ _id: h._id }, { $set: { active: false } }).exec();
                released++;
            }
            catch { }
        }
    }
    return released;
}
/**
 * Remove game snapshots without corresponding tables (stale in DB).
 * Returns number of game snapshots deleted.
 */
async function gcSnapshots() {
    if (!(0, auth_1.isDbConnected)())
        return 0;
    const snaps = await db_1.GameModel.find({}).select('gameId tableId').lean().exec().catch(() => []);
    const existingTableIds = new Set(Array.from(state_1.waitingTables.keys()));
    let deleted = 0;
    for (const g of snaps) {
        const tblId = String(g.tableId || '');
        if (!existingTableIds.has(tblId)) {
            try {
                await db_1.GameModel.deleteOne({ gameId: g.gameId }).exec();
                deleted++;
            }
            catch { }
        }
    }
    return deleted;
}
