import { Router } from 'express';
import { games, waitingTables } from '../socket/state';

const router = Router();

router.get('/metrics', (_req, res) => {
  const activeGames = Array.from(games.values()).length;
  const waiting = waitingTables.size;
  res.type('text/plain').send(
    [
      `rummy_active_games ${activeGames}`,
      `rummy_waiting_tables ${waiting}`,
      `process_uptime_seconds ${Math.floor(process.uptime())}`,
    ].join('\n'),
  );
});

export { router as metricsRouter };


