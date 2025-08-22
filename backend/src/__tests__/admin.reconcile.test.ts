import request from 'supertest';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { adminRouter } from '../services/admin.routes';
import * as auth from '../auth';
import * as db from '../db';

function makeApp() {
  const app = express();
  app.use(helmet());
  app.use(cors());
  app.use(express.json());
  app.use('/api/admin', adminRouter);
  return app;
}

describe('Admin reconcile endpoint', () => {
  const adminToken = 'admintoken';
  beforeAll(() => {
    jest.spyOn(require('../config'), 'loadConfig').mockReturnValue({ adminToken } as any);
    jest.spyOn(auth, 'isDbConnected').mockReturnValue(true as any);
  });

  afterAll(() => jest.restoreAllMocks());

  test('returns inconsistencies and sample', async () => {
    // Mock DB models minimal behavior
    (db as any).UserModel = {
      find: () => ({ select: () => ({ limit: () => ({ lean: () => ({ exec: async () => ([{ _id: 'u1', wallet: '50.00' }, { _id: 'u2', wallet: '0.00' }]) }) }) }) })
    };
    (db as any).WalletLedgerModel = {
      aggregate: () => ({ exec: async () => ([{ _id: 'u1', totalDelta: 60 }, { _id: 'u2', totalDelta: 0 }]) })
    };
    (db as any).WalletHoldModel = {
      aggregate: () => ({ exec: async () => ([{ _id: 'u1', totalHold: 10 }]) })
    };

    const app = makeApp();
    const res = await request(app).get('/api/admin/reconcile').set('x-admin-token', adminToken);
    expect(res.status).toBe(200);
    expect(res.body?.data?.count).toBeGreaterThan(0);
    expect(Array.isArray(res.body?.data?.inconsistencies)).toBe(true);
  });
});


