import request from 'supertest';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { adminRouter } from '../services/admin.routes';
import { poolStateByTable, dealsStateByTable } from '../socket/format.state';

function makeApp() {
  const app = express();
  app.use(helmet());
  app.use(cors());
  app.use(express.json());
  app.use('/api/admin', adminRouter);
  return app;
}

describe('Admin format-state endpoint', () => {
  const adminToken = 'admintoken';
  beforeAll(() => {
    jest.spyOn(require('../config'), 'loadConfig').mockReturnValue({ adminToken } as any);
  });

  afterEach(() => {
    poolStateByTable.clear();
    dealsStateByTable.clear();
  });

  afterAll(() => jest.restoreAllMocks());

  test('returns current pool and deals states', async () => {
    poolStateByTable.set('tbl-pool', { cumulative: { a: 10, b: 30 }, eliminated: new Set(['b']), threshold: 101 });
    dealsStateByTable.set('tbl-deals', { remaining: 1, cumulative: { x: 20, y: 0 } });

    const app = makeApp();
    const res = await request(app).get('/api/admin/format-state').set('x-admin-token', adminToken);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body?.data?.pool)).toBe(true);
    expect(Array.isArray(res.body?.data?.deals)).toBe(true);
    const pool = res.body.data.pool.find((p: any) => p.tableId === 'tbl-pool');
    const deals = res.body.data.deals.find((d: any) => d.tableId === 'tbl-deals');
    expect(pool.cumulative.a).toBe(10);
    expect(pool.eliminated).toContain('b');
    expect(pool.threshold).toBe(101);
    expect(deals.remaining).toBe(1);
    expect(deals.cumulative.x).toBe(20);
  });
});


