"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.metricsRouter = void 0;
const express_1 = require("express");
const state_1 = require("../socket/state");
const router = (0, express_1.Router)();
exports.metricsRouter = router;
router.get('/metrics', (_req, res) => {
    const activeGames = Array.from(state_1.games.values()).length;
    const waiting = state_1.waitingTables.size;
    res.type('text/plain').send([
        `rummy_active_games ${activeGames}`,
        `rummy_waiting_tables ${waiting}`,
        `process_uptime_seconds ${Math.floor(process.uptime())}`,
    ].join('\n'));
});
