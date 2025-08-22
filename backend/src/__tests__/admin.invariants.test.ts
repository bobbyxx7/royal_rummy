import request from 'supertest';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { adminRouter } from '../services/admin.routes';
import { WalletHoldModel, UserModel } from '../db';
import * as state from '../socket/state';

function makeApp() {
  const app = express();
  app.use(helmet());
  app.use(cors());
  app.use(express.json());
  app.use('/api/admin', adminRouter);
  return app;
}

describe('Admin invariants endpoint', () => {
  const adminToken = 'admintoken';
  beforeAll(() => {
    jest.spyOn(require('../config'), 'loadConfig').mockReturnValue({ adminToken } as any);
    jest.spyOn(require('../auth'), 'isDbConnected').mockReturnValue(true as any);
  });
  afterAll(() => jest.restoreAllMocks());

  test('returns invariants summary', async () => {
    (WalletHoldModel.find as any) = jest.fn().mockReturnValue({ lean: () => ({ exec: async () => ([
      { userId: 'u1', tableId: 't1', amount: 10, active: true },
      { userId: 'u1', tableId: 't1', amount: 10, active: true },
      { userId: 'u2', tableId: 'tX', amount: 20, active: true },
    ]) }) });
    (UserModel.find as any) = jest.fn().mockReturnValue({ select: () => ({ lean: () => ({ exec: async () => ([
      { _id: 'u1', wallet: '-1.01' },
      { _id: 'u2', wallet: '0.00' },
    ]) }) }) });
    (state as any).waitingTables = new Map([['t1', {}]]);
    ;(state as any).games = new Map([]);
    const app = makeApp();
    const res = await request(app).get('/api/admin/invariants').set('x-admin-token', adminToken);
    expect(res.status).toBe(200);
    expect(res.body?.data?.negativeWallets?.length).toBeGreaterThan(0);
  });
});


