import { Router } from 'express';
import { waitingTables, games, TABLE_ROOM } from '../socket/state';
import { RoundResultModel } from '../db';

const router = Router();

function requireAdmin(req: any, res: any, next: any) {
  const token = req.header('x-admin-token');
  const expected = process.env.ADMIN_TOKEN || '';
  if (!expected || token !== expected) return res.status(401).json({ code: 401, message: 'Unauthorized' });
  next();
}

// GET /api/admin/tables
router.get('/tables', requireAdmin, (_req, res) => {
  const list = Array.from(waitingTables.values()).map((t) => ({
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
  const list = Array.from(games.values()).map((g) => ({
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
    const docs = await RoundResultModel.find({}).sort({ createdAt: -1 }).limit(limit).lean().exec();
    res.json({ code: 200, data: docs });
  } catch (e) {
    res.status(500).json({ code: 500, message: 'Failed to fetch rounds' });
  }
});

// GET /api/admin/rake?from=ISO&to=ISO
router.get('/rake', requireAdmin, async (req, res) => {
  try {
    const from = req.query.from ? new Date(String(req.query.from)) : new Date(0);
    const to = req.query.to ? new Date(String(req.query.to)) : new Date();
    const match: any = { createdAt: { $gte: from, $lte: to } };
    const agg = await RoundResultModel.aggregate([
      { $match: match },
      { $group: { _id: null, totalRake: { $sum: { $ifNull: ['$rake', 0] } }, rounds: { $sum: 1 } } },
    ]).exec();
    const totalRakePercent = agg?.[0]?.totalRake ?? 0;
    const rounds = agg?.[0]?.rounds ?? 0;
    res.json({ code: 200, data: { totalRakePercent, rounds, from, to } });
  } catch (e) {
    res.status(500).json({ code: 500, message: 'Failed to compute rake' });
  }
});

export { router as adminRouter };


