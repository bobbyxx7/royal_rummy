"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runBackfill = runBackfill;
require("dotenv/config");
const db_1 = require("../db");
const config_1 = require("../config");
const reconcile_1 = require("../services/reconcile");
async function runBackfill() {
    const cfg = (0, config_1.loadConfig)();
    if (!cfg.mongoUri) {
        console.error('[backfill] MONGO_URI not set');
        process.exitCode = 1;
        return;
    }
    await (0, db_1.connectMongo)(cfg.mongoUri);
    const limit = Math.min(1000, Math.max(1, Number(process.env.BACKFILL_LIMIT || 100)));
    const threshold = Math.max(0.01, Number(process.env.BACKFILL_THRESHOLD || 0.01));
    const apply = (process.env.APPLY === '1') && (process.env.BACKFILL_GUARD === 'I_UNDERSTAND');
    const { inconsistencies } = await (0, reconcile_1.reconcileWallets)(limit);
    const repairs = inconsistencies.filter((r) => Math.abs(r.diff) >= threshold);
    const summary = { count: repairs.length, apply };
    if (!apply) {
        console.log(JSON.stringify({ ok: true, ...summary, repairs }));
        return;
    }
    for (const r of repairs) {
        const delta = Number((-r.diff).toFixed(2)); // move wallet to expected
        try {
            await db_1.WalletLedgerModel.create({ userId: r.userId, delta, reason: 'wallet_backfill', ref: 'backfill' });
            await db_1.UserModel.updateOne({ _id: r.userId }, [{ $set: { wallet: { $toString: { $round: [{ $add: [{ $toDouble: '$wallet' }, delta] }, 2] } } } }]).exec();
        }
        catch (e) {
            console.error('[backfill] failed for', r.userId, e);
        }
    }
    console.log(JSON.stringify({ ok: true, ...summary }));
}
if (require.main === module) {
    runBackfill().catch((e) => { console.error('[backfill] error', e); process.exitCode = 1; });
}
