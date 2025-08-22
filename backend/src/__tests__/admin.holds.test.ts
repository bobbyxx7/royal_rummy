import request from 'supertest';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { adminRouter } from '../services/admin.routes';
import { WalletHoldModel } from '../db';

function makeApp() {
  const app = express();
  app.use(helmet());
  app.use(cors());
  app.use(express.json());
  app.use('/api/admin', adminRouter);
  return app;
}

describe('Admin holds endpoint', () => {
  const adminToken = 'admintoken';
  beforeAll(() => {
    jest.spyOn(require('../config'), 'loadConfig').mockReturnValue({ adminToken } as any);
  });
  afterAll(() => jest.restoreAllMocks());

  test('lists holds with filters', async () => {
    (WalletHoldModel.find as any) = jest.fn().mockReturnValue({
      sort: () => ({ limit: () => ({ lean: () => ({ exec: async () => ([
        { userId: 'u1', tableId: 't1', amount: 10, active: true },
        { userId: 'u2', tableId: 't2', amount: 20, active: false },
      ]) }) }) })
    });
    const app = makeApp();
    const res = await request(app)
      .get('/api/admin/holds?active=1&userId=u1&tableId=t1')
      .set('x-admin-token', adminToken);
    expect(res.status).toBe(200);
    expect(res.body?.data?.length).toBeGreaterThanOrEqual(1);
  });
});


