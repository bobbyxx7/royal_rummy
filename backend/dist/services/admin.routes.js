"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.adminRouter = void 0;
const express_1 = require("express");
const state_1 = require("../socket/state");
const db_1 = require("../db");
const reconcile_1 = require("./reconcile");
const config_1 = require("../config");
const auth_1 = require("../auth");
const format_state_1 = require("../socket/format.state");
const errors_1 = require("../errors");
const router = (0, express_1.Router)();
exports.adminRouter = router;
function requireAdmin(req, res, next) {
    const token = req.header('x-admin-token');
    const expected = (0, config_1.loadConfig)().adminToken || '';
    if (!expected || token !== expected)
        return res.status(errors_1.ErrorCodes.UNAUTHORIZED).json({ code: errors_1.ErrorCodes.UNAUTHORIZED, message: 'Unauthorized' });
    next();
}
// GET /api/admin/tables
router.get('/tables', requireAdmin, (_req, res) => {
    const list = Array.from(state_1.waitingTables.values()).map((t) => ({
        id: t.id,
        bootValue: t.bootValue,
        noOfPlayers: t.noOfPlayers,
        status: t.status,
        players: t.players,
        createdAt: t.createdAt,
    }));
    res.json({ code: 200, data: list });
});
// GET /api/admin/games
router.get('/games', requireAdmin, (_req, res) => {
    const list = Array.from(state_1.games.values()).map((g) => ({
        id: g.id,
        tableId: g.tableId,
        players: g.players,
        currentTurn: g.currentTurn,
        deckCount: g.deck.length,
        discardTop: g.discardPile[g.discardPile.length - 1] || null,
        wildCardRank: g.wildCardRank,
        startedAt: g.startedAt,
    }));
    res.json({ code: 200, data: list });
});
// GET /api/admin/rounds?limit=20
router.get('/rounds', requireAdmin, async (req, res) => {
    const limit = Math.min(100, Math.max(1, Number(req.query.limit || 20)));
    try {
        const docs = await db_1.RoundResultModel.find({}).sort({ createdAt: -1 }).limit(limit).lean().exec();
        res.json({ code: 200, data: docs });
    }
    catch (e) {
        res.status(500).json({ code: 500, message: 'Failed to fetch rounds' });
    }
});
// GET /api/admin/rounds/search?tableId=&userId=&limit=
router.get('/rounds/search', requireAdmin, async (req, res) => {
    const limit = Math.min(100, Math.max(1, Number(req.query.limit || 20)));
    const tableId = req.query.tableId ? String(req.query.tableId) : undefined;
    const userId = req.query.userId ? String(req.query.userId) : undefined;
    const query = {};
    if (tableId)
        query.tableId = tableId;
    if (userId)
        query.$or = [{ winnerUserId: userId }, { 'points.user_id': userId }];
    try {
        const docs = await db_1.RoundResultModel.find(query).sort({ createdAt: -1 }).limit(limit).lean().exec();
        res.json({ code: 200, data: docs });
    }
    catch (e) {
        res.status(500).json({ code: 500, message: 'Failed to search rounds' });
    }
});
// GET /api/admin/rake?from=ISO&to=ISO
router.get('/rake', requireAdmin, async (req, res) => {
    try {
        const from = req.query.from ? new Date(String(req.query.from)) : new Date(0);
        const to = req.query.to ? new Date(String(req.query.to)) : new Date();
        const match = { createdAt: { $gte: from, $lte: to } };
        const agg = await db_1.RoundResultModel.aggregate([
            { $match: match },
            { $group: { _id: null, totalRake: { $sum: { $ifNull: ['$rake', 0] } }, rounds: { $sum: 1 } } },
        ]).exec();
        const totalRakePercent = agg?.[0]?.totalRake ?? 0;
        const rounds = agg?.[0]?.rounds ?? 0;
        res.json({ code: 200, data: { totalRakePercent, rounds, from, to } });
    }
    catch (e) {
        res.status(500).json({ code: 500, message: 'Failed to compute rake' });
    }
});
// Additional admin endpoints
// GET /api/admin/holds?active=1&userId=&tableId=
router.get('/holds', requireAdmin, async (req, res) => {
    try {
        const q = {};
        if (typeof req.query.active !== 'undefined')
            q.active = String(req.query.active) !== '0';
        if (req.query.userId)
            q.userId = String(req.query.userId);
        if (req.query.tableId)
            q.tableId = String(req.query.tableId);
        const rows = await db_1.WalletHoldModel.find(q).sort({ createdAt: -1 }).limit(200).lean().exec();
        return res.json({ code: 200, data: rows });
    }
    catch (e) {
        return res.status(500).json({ code: 500, message: 'Failed to fetch holds' });
    }
});
// GET /api/admin/invariants
router.get('/invariants', requireAdmin, async (_req, res) => {
    if (!(0, auth_1.isDbConnected)())
        return res.json({ code: 200, data: { multiHolds: [], holdsForMissingTable: [], negativeWallets: [] } });
    try {
        const holds = await db_1.WalletHoldModel.find({ active: true }).lean().exec();
        const keyToCount = new Map();
        for (const h of holds) {
            const k = `${h.userId}::${h.tableId}`;
            keyToCount.set(k, (keyToCount.get(k) || 0) + 1);
        }
        const multiHolds = Array.from(keyToCount.entries()).filter(([, c]) => c > 1).map(([k, c]) => ({ key: k, count: c }));
        const existingTableIds = new Set([
            ...Array.from(state_1.waitingTables.keys()),
            ...Array.from(state_1.games.values()).map((g) => g.tableId),
        ]);
        const holdsForMissingTable = holds.filter((h) => !existingTableIds.has(String(h.tableId)));
        const users = await db_1.UserModel.find({}).select('wallet').lean().exec();
        const negativeWallets = users.filter((u) => Number(u.wallet || '0') < 0).map((u) => ({ userId: String(u._id), wallet: u.wallet }));
        return res.json({ code: 200, data: { multiHolds, holdsForMissingTable, negativeWallets } });
    }
    catch (e) {
        return res.status(500).json({ code: 500, message: 'Failed to compute invariants' });
    }
});
// GET /api/admin/health
router.get('/health', requireAdmin, (_req, res) => {
    try {
        const db = !!(0, auth_1.isDbConnected)();
        const tables = state_1.waitingTables.size;
        const gameCount = Array.from(state_1.games.values()).length;
        const upMs = Math.floor(process.uptime() * 1000);
        res.json({ code: 200, data: { db, tables, games: gameCount, upMs } });
    }
    catch (e) {
        res.status(500).json({ code: 500, message: 'health_error' });
    }
});
// GET /api/admin/format-state
router.get('/format-state', requireAdmin, (_req, res) => {
    const pool = [];
    for (const [tableId, st] of format_state_1.poolStateByTable.entries()) {
        pool.push({ tableId, cumulative: st.cumulative, eliminated: Array.from(st.eliminated), threshold: st.threshold });
    }
    const deals = [];
    for (const [tableId, st] of format_state_1.dealsStateByTable.entries()) {
        deals.push({ tableId, remaining: st.remaining, cumulative: st.cumulative });
    }
    return res.json({ code: 200, data: { pool, deals } });
});
// GET /api/admin/sockets?tableId=
router.get('/sockets', requireAdmin, (req, res) => {
    try {
        const tableIdFilter = req.query.tableId ? String(req.query.tableId) : undefined;
        const data = Array.from(state_1.sessions.values())
            .filter((s) => (tableIdFilter ? s.tableId === tableIdFilter : true))
            .map((s) => ({ socketId: s.socketId, userId: s.userId, tableId: s.tableId, gameId: s.gameId, seatNo: s.seatNo }));
        res.json({ code: 200, data: { count: data.length, sessions: data } });
    }
    catch (e) {
        res.status(500).json({ code: 500, message: 'Failed to list sockets' });
    }
});
// GET /api/admin/reconcile?limit=100
router.get('/reconcile', requireAdmin, async (req, res) => {
    if (!(0, auth_1.isDbConnected)())
        return res.status(503).json({ code: 503, message: 'DB not connected' });
    try {
        const limit = Math.min(1000, Math.max(1, Number(req.query.limit || 100)));
        const data = await (0, reconcile_1.reconcileWallets)(limit);
        return res.json({ code: 200, data });
    }
    catch (e) {
        return res.status(500).json({ code: 500, message: 'Failed to reconcile wallets' });
    }
});
