import request from 'supertest';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { tablesRouter } from '../services/tables.routes';
import { waitingTables, createOrFindTable } from '../socket/state';

function makeApp() {
  const app = express();
  app.use(helmet());
  app.use(cors());
  app.use(express.json());
  app.use('/api', tablesRouter);
  return app;
}

describe('GET /api/tables/available', () => {
  test('returns available tables with filters and pagination', async () => {
    waitingTables.clear();
    const t1 = createOrFindTable('80', 2);
    const t2 = createOrFindTable('800', 6);
    const app = makeApp();
    const res = await request(app).get('/api/tables/available').query({ boot_value: '80', no_of_players: 2 });
    expect(res.status).toBe(200);
    expect(res.body?.data?.length).toBeGreaterThanOrEqual(1);
    expect(res.body.data[0]).toHaveProperty('table_id');
    expect(res.body.data[0]).toHaveProperty('joined');
  });
});


