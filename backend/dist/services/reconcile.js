"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.reconcileWallets = reconcileWallets;
const db_1 = require("../db");
async function reconcileWallets(limit = 100) {
    const lim = Math.min(1000, Math.max(1, Number(limit || 100)));
    const users = await db_1.UserModel.find({}).select('wallet').limit(lim).lean().exec();
    const userIds = users.map(u => String(u._id));
    const ledgers = await db_1.WalletLedgerModel.aggregate([
        { $match: { userId: { $in: userIds } } },
        { $group: { _id: '$userId', totalDelta: { $sum: '$delta' } } },
    ]).exec();
    const holds = await db_1.WalletHoldModel.aggregate([
        { $match: { userId: { $in: userIds }, active: true } },
        { $group: { _id: '$userId', totalHold: { $sum: { $toDouble: '$amount' } } } },
    ]).exec();
    const userIdToLedger = new Map(ledgers.map((r) => [String(r._id), Number(r.totalDelta || 0)]));
    const userIdToHold = new Map(holds.map((r) => [String(r._id), Number(r.totalHold || 0)]));
    const results = users.map(u => {
        const uid = String(u._id);
        const wallet = Number(u.wallet || '0');
        const totalDelta = userIdToLedger.get(uid) || 0;
        const totalHold = userIdToHold.get(uid) || 0;
        const expected = Number((totalDelta - totalHold).toFixed(2));
        const diff = Number((wallet - expected).toFixed(2));
        return { userId: uid, wallet, totalDelta, totalHold, expected, diff };
    });
    const inconsistencies = results.filter(r => Math.abs(r.diff) > 0.01);
    return { count: results.length, inconsistencies, sample: results.slice(0, 20) };
}
