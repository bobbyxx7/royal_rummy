import request from 'supertest';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { adminRouter } from '../services/admin.routes';
import * as state from '../socket/state';

function makeApp() {
  const app = express();
  app.use(helmet());
  app.use(cors());
  app.use(express.json());
  app.use('/api/admin', adminRouter);
  return app;
}

describe('Admin sockets endpoint', () => {
  const adminToken = 'admintoken';
  beforeAll(() => {
    jest.spyOn(require('../config'), 'loadConfig').mockReturnValue({ adminToken } as any);
  });
  afterAll(() => jest.restoreAllMocks());

  test('lists sessions with optional filter', async () => {
    (state as any).sessions = new Map<string, any>([
      ['s1', { socketId: 's1', userId: 'u1', tableId: 't1', gameId: 'g1', seatNo: 0 }],
      ['s2', { socketId: 's2', userId: 'u2', tableId: 't2', gameId: 'g2', seatNo: 1 }],
    ]);
    const app = makeApp();
    const res = await request(app).get('/api/admin/sockets?tableId=t1').set('x-admin-token', adminToken);
    expect(res.status).toBe(200);
    expect(res.body?.data?.count).toBe(1);
    expect(res.body?.data?.sessions?.[0]?.tableId).toBe('t1');
  });
});


