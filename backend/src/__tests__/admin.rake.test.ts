import request from 'supertest';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { adminRouter } from '../services/admin.routes';
import { RoundResultModel } from '../db';

function makeApp() {
  const app = express();
  app.use(helmet());
  app.use(cors());
  app.use(express.json());
  app.use('/api/admin', adminRouter);
  return app;
}

describe('Admin rake endpoint', () => {
  const adminToken = 'admintoken';
  beforeAll(() => {
    jest.spyOn(require('../config'), 'loadConfig').mockReturnValue({ adminToken } as any);
  });
  afterAll(() => jest.restoreAllMocks());

  test('aggregates rake over time range', async () => {
    (RoundResultModel.aggregate as any) = jest.fn().mockReturnValue({ exec: async () => ([{ totalRake: 12.5, rounds: 5 }]) });
    const app = makeApp();
    const res = await request(app).get('/api/admin/rake?from=2020-01-01&to=2030-01-01').set('x-admin-token', adminToken);
    expect(res.status).toBe(200);
    expect(res.body?.data?.rounds).toBeDefined();
  });
});


