import { Router } from 'express';

const router = Router();

// Simple static tiers for lobby. In prod, this could come from DB/config.
// pointValue used by server; bootValue is a label and a matchmaking key in our API.
router.get('/tables', (_req, res) => {
  const tiers = [
    { bootValue: '80', pointValue: Number(process.env.POINT_VALUE || 1), players: [2, 6] },
    { bootValue: '800', pointValue: Number(process.env.POINT_VALUE || 1), players: [2, 6] },
  ];
  res.json({ code: 200, data: tiers });
});

export { router as tablesRouter };


