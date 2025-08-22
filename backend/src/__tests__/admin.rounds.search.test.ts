import request from 'supertest';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { adminRouter } from '../services/admin.routes';
import * as db from '../db';

function makeApp() {
  const app = express();
  app.use(helmet());
  app.use(cors());
  app.use(express.json());
  app.use('/api/admin', adminRouter);
  return app;
}

describe('Admin rounds search endpoint', () => {
  const adminToken = 'admintoken';
  beforeAll(() => {
    jest.spyOn(require('../config'), 'loadConfig').mockReturnValue({ adminToken } as any);
  });
  afterAll(() => jest.restoreAllMocks());

  test('search by tableId and userId returns results', async () => {
    (db as any).RoundResultModel = {
      find: (_q: any) => ({ sort: () => ({ limit: () => ({ lean: () => ({ exec: async () => ([{ tableId: 't1', winnerUserId: 'u1', points: [] }]) }) }) }) })
    };
    const app = makeApp();
    const res = await request(app).get('/api/admin/rounds/search?tableId=t1&userId=u1&limit=10').set('x-admin-token', adminToken);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body?.data)).toBe(true);
    expect(res.body.data[0]?.tableId).toBe('t1');
  });
});


