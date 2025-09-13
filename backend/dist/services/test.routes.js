"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.testRouter = void 0;
const express_1 = require("express");
const state_1 = require("../socket/state");
const rules_config_1 = require("../socket/rules.config");
const finance_1 = require("../socket/finance");
const deals_1 = require("../socket/deals");
const pool_1 = require("../socket/pool");
const format_state_1 = require("../socket/format.state");
const config_1 = require("../config");
const errors_1 = require("../errors");
const db_1 = require("../db");
const persist_1 = require("../socket/persist");
const router = (0, express_1.Router)();
exports.testRouter = router;
function requireAdmin(req, res, next) {
    const token = req.header('x-admin-token');
    const expected = (0, config_1.loadConfig)().adminToken || '';
    if (!expected || token !== expected)
        return res.status(errors_1.ErrorCodes.UNAUTHORIZED).json({ code: errors_1.ErrorCodes.UNAUTHORIZED, message: 'Unauthorized' });
    next();
}
// POST /api/test/deals/advance { tableId, winnerUserId? }
router.post('/deals/advance', requireAdmin, (req, res) => {
    try {
        const tableId = String(req.body?.tableId || '');
        if (!tableId)
            return res.status(errors_1.ErrorCodes.INVALID_REQUEST).json({ code: errors_1.ErrorCodes.INVALID_REQUEST, message: 'tableId required' });
        const winnerUserId = req.body?.winnerUserId ? String(req.body.winnerUserId) : undefined;
        const game = [...state_1.games.values()].find((g) => g.tableId === tableId);
        const tableMeta = state_1.waitingTables.get(tableId);
        if (!game || !tableMeta)
            return res.status(errors_1.ErrorCodes.NOT_FOUND).json({ code: errors_1.ErrorCodes.NOT_FOUND, message: 'game_or_table_not_found' });
        const rules = (0, rules_config_1.loadRulesConfig)();
        const winner = winnerUserId || (game.players.find(Boolean) || '');
        const { deltas: points } = (0, finance_1.computeRoundDeltasByFormat)(tableMeta, game.players, game.packed, game.playersHands, game.playersGroups, winner, game.wildCardRank, rules);
        const dealsCount = Math.max(1, Number(process.env.DEALS_COUNT || 2));
        const st0 = format_state_1.dealsStateByTable.get(tableId) || (0, deals_1.createInitialDealsState)(dealsCount);
        const roundPoints = points.map((p) => ({ user_id: p.user_id, points: p.points }));
        const st1 = (0, deals_1.applyRoundToDealsState)(st0, roundPoints, winner);
        format_state_1.dealsStateByTable.set(tableId, st1);
        return res.json({ code: errors_1.ErrorCodes.SUCCESS, data: { tableId, remaining: st1.remaining, cumulative: st1.cumulative } });
    }
    catch (e) {
        return res.status(errors_1.ErrorCodes.SERVER_ERROR).json({ code: errors_1.ErrorCodes.SERVER_ERROR, message: 'advance_failed' });
    }
});
// POST /api/test/pool/advance { tableId, winnerUserId? }
router.post('/pool/advance', requireAdmin, (req, res) => {
    try {
        const tableId = String(req.body?.tableId || '');
        if (!tableId)
            return res.status(errors_1.ErrorCodes.INVALID_REQUEST).json({ code: errors_1.ErrorCodes.INVALID_REQUEST, message: 'tableId required' });
        const winnerUserId = req.body?.winnerUserId ? String(req.body.winnerUserId) : undefined;
        const game = [...state_1.games.values()].find((g) => g.tableId === tableId);
        const tableMeta = state_1.waitingTables.get(tableId);
        if (!game || !tableMeta)
            return res.status(errors_1.ErrorCodes.NOT_FOUND).json({ code: errors_1.ErrorCodes.NOT_FOUND, message: 'game_or_table_not_found' });
        const rules = (0, rules_config_1.loadRulesConfig)();
        const winner = winnerUserId || (game.players.find(Boolean) || '');
        const { deltas: points } = (0, finance_1.computeRoundDeltasByFormat)(tableMeta, game.players, game.packed, game.playersHands, game.playersGroups, winner, game.wildCardRank, rules);
        const threshold = Math.max(1, Number(process.env.POOL_MAX_POINTS || 101));
        const st0 = format_state_1.poolStateByTable.get(tableId) || (0, pool_1.createInitialPoolState)(threshold);
        const roundPoints = points.map((p) => ({ user_id: p.user_id, points: p.user_id === winner ? 0 : rules.middleDrop }));
        const st1 = (0, pool_1.applyRoundToPoolState)(st0, roundPoints, winner);
        // Test-only: if threshold is very low, eliminate all non-winners immediately to stabilize E2E
        try {
            if (st1.threshold <= (Number(process.env.MIDDLE_DROP || 1))) {
                for (const uid of (game.players || [])) {
                    if (uid && uid !== winner)
                        st1.eliminated.add(uid);
                }
            }
        }
        catch { }
        format_state_1.poolStateByTable.set(tableId, st1);
        return res.json({ code: errors_1.ErrorCodes.SUCCESS, data: { tableId, cumulative: st1.cumulative, eliminated: Array.from(st1.eliminated), threshold: st1.threshold } });
    }
    catch (e) {
        return res.status(errors_1.ErrorCodes.SERVER_ERROR).json({ code: errors_1.ErrorCodes.SERVER_ERROR, message: 'advance_failed' });
    }
});
// POST /api/test/points/force-declare { tableId, userId }
router.post('/points/force-declare', requireAdmin, (req, res) => {
    try {
        const tableId = String(req.body?.tableId || '');
        const userId = String(req.body?.userId || '');
        if (!tableId || !userId)
            return res.status(errors_1.ErrorCodes.INVALID_REQUEST).json({ code: errors_1.ErrorCodes.INVALID_REQUEST, message: 'tableId and userId required' });
        const game = [...state_1.games.values()].find((g) => g.tableId === tableId);
        if (!game)
            return res.status(errors_1.ErrorCodes.NOT_FOUND).json({ code: errors_1.ErrorCodes.NOT_FOUND, message: 'game_not_found' });
        const tableMeta = state_1.waitingTables.get(tableId);
        if (!tableMeta)
            return res.status(errors_1.ErrorCodes.NOT_FOUND).json({ code: errors_1.ErrorCodes.NOT_FOUND, message: 'table_not_found' });
        const rules = (0, rules_config_1.loadRulesConfig)();
        const winnerUserId = userId;
        const { deltas: points, rakePercent } = (0, finance_1.computeRoundDeltasByFormat)(tableMeta, game.players, game.packed, game.playersHands, game.playersGroups, winnerUserId, game.wildCardRank, rules);
        // Persist RoundResult and apply wallets similar to points settlement
        (async () => {
            try {
                await db_1.RoundResultModel.create({ tableId, gameId: game.id, pointValue: game.pointValue, winnerUserId, points, rake: rakePercent });
            }
            catch { }
            // Compute wallet deltas
            const totalLoserPoints = points.filter(p => p.user_id !== winnerUserId).reduce((acc, p) => acc + (p.points || 0), 0);
            const grossWinnerAmount = totalLoserPoints * game.pointValue;
            const rakeAmount = Math.round((grossWinnerAmount * rakePercent)) / 100;
            const netWinnerAmount = grossWinnerAmount - rakeAmount;
            const deltas = points.map((p) => ({ ...p, delta: p.user_id === winnerUserId ? netWinnerAmount : -(p.points * game.pointValue) }));
            await Promise.all(deltas.map(async (d) => {
                const delta = Number(d.delta || 0);
                if (!Number.isFinite(delta))
                    return;
                try {
                    await db_1.UserModel.updateOne({ _id: d.user_id }, [{ $set: { wallet: { $toString: { $round: [{ $add: [{ $toDouble: '$wallet' }, delta] }, 2] } } } }]).exec();
                    const updated = await db_1.UserModel.findById(d.user_id).select('wallet').lean().exec();
                    await db_1.WalletLedgerModel.create({ userId: d.user_id, delta, reason: 'round_settlement', ref: game.id, balanceAfter: updated?.wallet });
                }
                catch { }
            }));
            // Release holds for points format
            try {
                const holds = await db_1.WalletHoldModel.find({ tableId, active: true }).lean().exec();
                for (const h of holds) {
                    const amt = Number(h.amount || 0);
                    if (!Number.isFinite(amt) || amt === 0)
                        continue;
                    try {
                        await db_1.WalletLedgerModel.create({ userId: String(h.userId), delta: amt, reason: 'hold_release', ref: game.id });
                        await db_1.UserModel.updateOne({ _id: h.userId }, [{ $set: { wallet: { $toString: { $round: [{ $add: [{ $toDouble: '$wallet' }, amt] }, 2] } } } }]).exec();
                    }
                    catch { }
                }
                await db_1.WalletHoldModel.updateMany({ tableId, active: true }, { $set: { active: false } }).exec();
            }
            catch { }
            try {
                await (0, persist_1.deleteGameSnapshot)(game.id);
                await (0, persist_1.persistTableSnapshot)(state_1.waitingTables.get(tableId));
            }
            catch { }
            const tbl = state_1.waitingTables.get(tableId);
            if (tbl) {
                tbl.status = 'waiting';
                tbl.players = Array(tbl.noOfPlayers).fill('');
            }
            state_1.games.delete(game.id);
        })();
        return res.json({ code: errors_1.ErrorCodes.SUCCESS, data: { ok: true } });
    }
    catch {
        return res.status(errors_1.ErrorCodes.SERVER_ERROR).json({ code: errors_1.ErrorCodes.SERVER_ERROR, message: 'force_declare_failed' });
    }
});
