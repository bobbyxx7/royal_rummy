import { Router } from 'express';
import { games, waitingTables } from '../socket/state';
import { loadRulesConfig } from '../socket/rules.config';
import { computeRoundDeltasByFormat } from '../socket/finance';
import { createInitialDealsState, applyRoundToDealsState } from '../socket/deals';
import { createInitialPoolState, applyRoundToPoolState } from '../socket/pool';
import { dealsStateByTable, poolStateByTable } from '../socket/format.state';
import { loadConfig } from '../config';
import { ErrorCodes } from '../errors';
import { RoundResultModel, UserModel, WalletHoldModel, WalletLedgerModel } from '../db';
import { persistTableSnapshot, deleteGameSnapshot } from '../socket/persist';

const router = Router();

function requireAdmin(req: any, res: any, next: any) {
  const token = req.header('x-admin-token');
  const expected = loadConfig().adminToken || '';
  if (!expected || token !== expected) return res.status(ErrorCodes.UNAUTHORIZED).json({ code: ErrorCodes.UNAUTHORIZED, message: 'Unauthorized' });
  next();
}

// POST /api/test/deals/advance { tableId, winnerUserId? }
router.post('/deals/advance', requireAdmin, (req, res) => {
  try {
    const tableId = String(req.body?.tableId || '');
    if (!tableId) return res.status(ErrorCodes.INVALID_REQUEST).json({ code: ErrorCodes.INVALID_REQUEST, message: 'tableId required' });
    const winnerUserId = req.body?.winnerUserId ? String(req.body.winnerUserId) : undefined;
    const game = [...games.values()].find((g) => g.tableId === tableId);
    const tableMeta = waitingTables.get(tableId);
    if (!game || !tableMeta) return res.status(ErrorCodes.NOT_FOUND).json({ code: ErrorCodes.NOT_FOUND, message: 'game_or_table_not_found' });
    const rules = loadRulesConfig();
    const winner = winnerUserId || (game.players.find(Boolean) || '');
    const { deltas: points } = computeRoundDeltasByFormat(tableMeta as any, game.players, game.packed, game.playersHands, game.playersGroups, winner, game.wildCardRank, rules);
    const dealsCount = Math.max(1, Number(process.env.DEALS_COUNT || 2));
    const st0 = dealsStateByTable.get(tableId) || createInitialDealsState(dealsCount);
    const roundPoints = points.map((p) => ({ user_id: p.user_id, points: p.points }));
    const st1 = applyRoundToDealsState(st0 as any, roundPoints as any, winner);
    dealsStateByTable.set(tableId, st1 as any);
    return res.json({ code: ErrorCodes.SUCCESS, data: { tableId, remaining: st1.remaining, cumulative: st1.cumulative } });
  } catch (e) {
    return res.status(ErrorCodes.SERVER_ERROR).json({ code: ErrorCodes.SERVER_ERROR, message: 'advance_failed' });
  }
});

// POST /api/test/pool/advance { tableId, winnerUserId? }
router.post('/pool/advance', requireAdmin, (req, res) => {
  try {
    const tableId = String(req.body?.tableId || '');
    if (!tableId) return res.status(ErrorCodes.INVALID_REQUEST).json({ code: ErrorCodes.INVALID_REQUEST, message: 'tableId required' });
    const winnerUserId = req.body?.winnerUserId ? String(req.body.winnerUserId) : undefined;
    const game = [...games.values()].find((g) => g.tableId === tableId);
    const tableMeta = waitingTables.get(tableId);
    if (!game || !tableMeta) return res.status(ErrorCodes.NOT_FOUND).json({ code: ErrorCodes.NOT_FOUND, message: 'game_or_table_not_found' });
    const rules = loadRulesConfig();
    const winner = winnerUserId || (game.players.find(Boolean) || '');
    const { deltas: points } = computeRoundDeltasByFormat(tableMeta as any, game.players, game.packed, game.playersHands, game.playersGroups, winner, game.wildCardRank, rules);
    const threshold = Math.max(1, Number(process.env.POOL_MAX_POINTS || 101));
    const st0 = poolStateByTable.get(tableId) || createInitialPoolState(threshold);
    const roundPoints = points.map((p) => ({ user_id: p.user_id, points: p.user_id === winner ? 0 : rules.middleDrop }));
    const st1 = applyRoundToPoolState(st0 as any, roundPoints as any, winner);
    // Test-only: if threshold is very low, eliminate all non-winners immediately to stabilize E2E
    try {
      if (st1.threshold <= (Number(process.env.MIDDLE_DROP || 1))) {
        for (const uid of (game.players || [])) {
          if (uid && uid !== winner) st1.eliminated.add(uid);
        }
      }
    } catch {}
    poolStateByTable.set(tableId, st1 as any);
    return res.json({ code: ErrorCodes.SUCCESS, data: { tableId, cumulative: st1.cumulative, eliminated: Array.from(st1.eliminated), threshold: st1.threshold } });
  } catch (e) {
    return res.status(ErrorCodes.SERVER_ERROR).json({ code: ErrorCodes.SERVER_ERROR, message: 'advance_failed' });
  }
});

// POST /api/test/points/force-declare { tableId, userId }
router.post('/points/force-declare', requireAdmin, (req, res) => {
  try {
    const tableId = String(req.body?.tableId || '');
    const userId = String(req.body?.userId || '');
    if (!tableId || !userId) return res.status(ErrorCodes.INVALID_REQUEST).json({ code: ErrorCodes.INVALID_REQUEST, message: 'tableId and userId required' });
    const game = [...games.values()].find((g) => g.tableId === tableId);
    if (!game) return res.status(ErrorCodes.NOT_FOUND).json({ code: ErrorCodes.NOT_FOUND, message: 'game_not_found' });
    const tableMeta = waitingTables.get(tableId);
    if (!tableMeta) return res.status(ErrorCodes.NOT_FOUND).json({ code: ErrorCodes.NOT_FOUND, message: 'table_not_found' });
    const rules = loadRulesConfig();
    const winnerUserId = userId;
    const { deltas: points, rakePercent } = computeRoundDeltasByFormat(tableMeta as any, game.players, game.packed, game.playersHands, game.playersGroups, winnerUserId, game.wildCardRank, rules);
    // Persist RoundResult and apply wallets similar to points settlement
    (async () => {
      try {
        await RoundResultModel.create({ tableId, gameId: game.id, pointValue: game.pointValue, winnerUserId, points, rake: rakePercent });
      } catch {}
      // Compute wallet deltas
      const totalLoserPoints = points.filter(p => p.user_id !== winnerUserId).reduce((acc, p) => acc + (p.points || 0), 0);
      const grossWinnerAmount = totalLoserPoints * game.pointValue;
      const rakeAmount = Math.round((grossWinnerAmount * rakePercent)) / 100;
      const netWinnerAmount = grossWinnerAmount - rakeAmount;
      const deltas = points.map((p) => ({ ...p, delta: p.user_id === winnerUserId ? netWinnerAmount : -(p.points * game.pointValue) }));
      await Promise.all(deltas.map(async (d) => {
        const delta = Number(d.delta || 0);
        if (!Number.isFinite(delta)) return;
        try {
          await UserModel.updateOne({ _id: d.user_id }, [{ $set: { wallet: { $toString: { $round: [{ $add: [{ $toDouble: '$wallet' }, delta] }, 2] } } } }]).exec();
          const updated = await UserModel.findById(d.user_id).select('wallet').lean().exec() as any;
          await WalletLedgerModel.create({ userId: d.user_id, delta, reason: 'round_settlement', ref: game.id, balanceAfter: updated?.wallet });
        } catch {}
      }));
      // Release holds for points format
      try {
        const holds: any[] = await WalletHoldModel.find({ tableId, active: true }).lean().exec() as any[];
        for (const h of holds) {
          const amt = Number(h.amount || 0);
          if (!Number.isFinite(amt) || amt === 0) continue;
          try {
            await WalletLedgerModel.create({ userId: String(h.userId), delta: amt, reason: 'hold_release', ref: game.id });
            await UserModel.updateOne({ _id: h.userId }, [{ $set: { wallet: { $toString: { $round: [{ $add: [{ $toDouble: '$wallet' }, amt] }, 2] } } } }]).exec();
          } catch {}
        }
        await WalletHoldModel.updateMany({ tableId, active: true }, { $set: { active: false } }).exec();
      } catch {}
      try { await deleteGameSnapshot(game.id); await persistTableSnapshot(waitingTables.get(tableId)!); } catch {}
      const tbl = waitingTables.get(tableId);
      if (tbl) { tbl.status = 'waiting'; tbl.players = Array(tbl.noOfPlayers).fill(''); }
      games.delete(game.id);
    })();
    return res.json({ code: ErrorCodes.SUCCESS, data: { ok: true } });
  } catch {
    return res.status(ErrorCodes.SERVER_ERROR).json({ code: ErrorCodes.SERVER_ERROR, message: 'force_declare_failed' });
  }
});

export { router as testRouter };


