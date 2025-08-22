import { Router } from 'express';
import { loadConfig } from '../config';
import { waitingTables } from '../socket/state';
import { z } from 'zod';
import { ErrorCodes } from '../errors';

const router = Router();

// Simple static tiers for lobby. In prod, this could come from DB/config.
// pointValue used by server; bootValue is a label and a matchmaking key in our API.
router.get('/tables', (_req, res) => {
  const cfg = loadConfig();
  const tiers = [
    { bootValue: '80', pointValue: cfg.pointValue, players: [2, 6] },
    { bootValue: '800', pointValue: cfg.pointValue, players: [2, 6] },
  ];
  res.json({ code: ErrorCodes.SUCCESS, data: tiers });
});

// GET /api/tables/available?boot_value=80&no_of_players=2&format=points&limit=20&skip=0
router.get('/tables/available', (req, res) => {
  const qp = z.object({
    boot_value: z.string().optional(),
    no_of_players: z.coerce.number().int().min(2).max(6).optional(),
    format: z.enum(['points', 'deals', 'pool']).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    skip: z.coerce.number().int().min(0).default(0),
  }).safeParse(req.query);
  if (!qp.success) return res.status(ErrorCodes.INVALID_REQUEST).json({ code: ErrorCodes.INVALID_REQUEST, message: 'Invalid query' });
  const { boot_value, no_of_players, format, limit, skip } = qp.data;

  const rows = Array.from(waitingTables.values()).map((t) => ({
    table_id: t.id,
    boot_value: t.bootValue,
    no_of_players: t.noOfPlayers,
    joined: t.players.filter(Boolean).length,
    status: t.status,
    createdAt: t.createdAt,
    format: t.format || 'points',
  }));
  const filtered = rows.filter((r) => {
    if (boot_value && r.boot_value !== boot_value) return false;
    if (no_of_players && r.no_of_players !== no_of_players) return false;
    if (format && r.format !== format) return false;
    return true;
  });
  const paged = filtered.slice(skip, skip + limit);
  return res.json({ code: ErrorCodes.SUCCESS, message: 'Success', total: filtered.length, data: paged });
});

export { router as tablesRouter };


