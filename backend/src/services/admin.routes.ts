import { Router } from 'express';
import { waitingTables, games, TABLE_ROOM, sessions } from '../socket/state';
import { RoundResultModel, WalletHoldModel, UserModel, WalletLedgerModel } from '../db';
import { reconcileWallets } from './reconcile';
import { loadConfig } from '../config';
import { isDbConnected } from '../auth';
import { poolStateByTable, dealsStateByTable } from '../socket/format.state';
import { ErrorCodes } from '../errors';

const router = Router();

function requireAdmin(req: any, res: any, next: any) {
  const token = req.header('x-admin-token');
  const expected = loadConfig().adminToken || '';
  if (!expected || token !== expected) return res.status(ErrorCodes.UNAUTHORIZED).json({ code: ErrorCodes.UNAUTHORIZED, message: 'Unauthorized' });
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

// GET /api/admin/rounds/search?tableId=&userId=&limit=
router.get('/rounds/search', requireAdmin, async (req, res) => {
  const limit = Math.min(100, Math.max(1, Number(req.query.limit || 20)));
  const tableId = req.query.tableId ? String(req.query.tableId) : undefined;
  const userId = req.query.userId ? String(req.query.userId) : undefined;
  const query: any = {};
  if (tableId) query.tableId = tableId;
  if (userId) query.$or = [{ winnerUserId: userId }, { 'points.user_id': userId }];
  try {
    const docs = await RoundResultModel.find(query).sort({ createdAt: -1 }).limit(limit).lean().exec();
    res.json({ code: 200, data: docs });
  } catch (e) {
    res.status(500).json({ code: 500, message: 'Failed to search rounds' });
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

// Additional admin endpoints
// GET /api/admin/holds?active=1&userId=&tableId=
router.get('/holds', requireAdmin, async (req, res) => {
  try {
    const q: any = {};
    if (typeof req.query.active !== 'undefined') q.active = String(req.query.active) !== '0';
    if (req.query.userId) q.userId = String(req.query.userId);
    if (req.query.tableId) q.tableId = String(req.query.tableId);
    const rows = await WalletHoldModel.find(q).sort({ createdAt: -1 }).limit(200).lean().exec();
    return res.json({ code: 200, data: rows });
  } catch (e) {
    return res.status(500).json({ code: 500, message: 'Failed to fetch holds' });
  }
});

// GET /api/admin/invariants
router.get('/invariants', requireAdmin, async (_req, res) => {
  if (!isDbConnected()) return res.json({ code: 200, data: { multiHolds: [], holdsForMissingTable: [], negativeWallets: [] } });
  try {
    const holds = await WalletHoldModel.find({ active: true }).lean().exec();
    const keyToCount = new Map<string, number>();
    for (const h of holds as any[]) {
      const k = `${h.userId}::${h.tableId}`;
      keyToCount.set(k, (keyToCount.get(k) || 0) + 1);
    }
    const multiHolds = Array.from(keyToCount.entries()).filter(([, c]) => c > 1).map(([k, c]) => ({ key: k, count: c }));
    const existingTableIds = new Set<string>([
      ...Array.from(waitingTables.keys()),
      ...Array.from(games.values()).map((g) => g.tableId),
    ]);
    const holdsForMissingTable = (holds as any[]).filter((h) => !existingTableIds.has(String(h.tableId)));
    const users = await UserModel.find({}).select('wallet').lean().exec();
    const negativeWallets = (users as any[]).filter((u) => Number(u.wallet || '0') < 0).map((u) => ({ userId: String(u._id), wallet: u.wallet }));
    return res.json({ code: 200, data: { multiHolds, holdsForMissingTable, negativeWallets } });
  } catch (e) {
    return res.status(500).json({ code: 500, message: 'Failed to compute invariants' });
  }
});

// GET /api/admin/health
router.get('/health', requireAdmin, (_req, res) => {
  try {
    const db = !!isDbConnected();
    const tables = waitingTables.size;
    const gameCount = Array.from(games.values()).length;
    const upMs = Math.floor(process.uptime() * 1000);
    res.json({ code: 200, data: { db, tables, games: gameCount, upMs } });
  } catch (e) {
    res.status(500).json({ code: 500, message: 'health_error' });
  }
});

// GET /api/admin/format-state
router.get('/format-state', requireAdmin, (_req, res) => {
  const pool: any[] = [];
  for (const [tableId, st] of poolStateByTable.entries()) {
    pool.push({ tableId, cumulative: st.cumulative, eliminated: Array.from(st.eliminated), threshold: st.threshold });
  }
  const deals: any[] = [];
  for (const [tableId, st] of dealsStateByTable.entries()) {
    deals.push({ tableId, remaining: st.remaining, cumulative: st.cumulative });
  }
  return res.json({ code: 200, data: { pool, deals } });
});

// GET /api/admin/sockets?tableId=
router.get('/sockets', requireAdmin, (req, res) => {
  try {
    const tableIdFilter = req.query.tableId ? String(req.query.tableId) : undefined;
    const data = Array.from(sessions.values())
      .filter((s) => (tableIdFilter ? s.tableId === tableIdFilter : true))
      .map((s) => ({ socketId: s.socketId, userId: s.userId, tableId: s.tableId, gameId: s.gameId, seatNo: s.seatNo }));
    res.json({ code: 200, data: { count: data.length, sessions: data } });
  } catch (e) {
    res.status(500).json({ code: 500, message: 'Failed to list sockets' });
  }
});

// GET /api/admin/reconcile?limit=100
router.get('/reconcile', requireAdmin, async (req, res) => {
  if (!isDbConnected()) return res.status(503).json({ code: 503, message: 'DB not connected' });
  try {
    const limit = Math.min(1000, Math.max(1, Number(req.query.limit || 100)));
    const data = await reconcileWallets(limit);
    return res.json({ code: 200, data });
  } catch (e) {
    return res.status(500).json({ code: 500, message: 'Failed to reconcile wallets' });
  }
});


