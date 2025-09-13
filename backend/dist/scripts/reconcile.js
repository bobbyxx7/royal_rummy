"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runReconcile = runReconcile;
require("dotenv/config");
const db_1 = require("../db");
const config_1 = require("../config");
const reconcile_1 = require("../services/reconcile");
async function runReconcile() {
    const cfg = (0, config_1.loadConfig)();
    if (!cfg.mongoUri) {
        // eslint-disable-next-line no-console
        console.error('[reconcile] MONGO_URI not set');
        process.exitCode = 1;
        return;
    }
    await (0, db_1.connectMongo)(cfg.mongoUri);
    const limit = Math.min(1000, Math.max(1, Number(process.env.RECONCILE_LIMIT || 100)));
    const res = await (0, reconcile_1.reconcileWallets)(limit);
    // eslint-disable-next-line no-console
    console.log(JSON.stringify({ ok: true, ...res }));
}
if (require.main === module) {
    runReconcile().catch((e) => {
        // eslint-disable-next-line no-console
        console.error('[reconcile] failed', e);
        process.exitCode = 1;
    });
}
