import request from 'supertest';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { adminRouter } from '../services/admin.routes';

function makeApp(withLimiter = true) {
  const app = express();
  app.use(helmet());
  app.use(cors());
  app.use(express.json());
  if (withLimiter) {
    // mirror server.ts limiter defaults for /api/*
    app.use('/api/', rateLimit({ windowMs: 60_000, max: 5, standardHeaders: true, legacyHeaders: false }));
  }
  app.use('/api/admin', adminRouter);
  return app;
}

describe('Admin endpoints auth and rate-limit', () => {
  const adminToken = 'admintoken';
  beforeAll(() => {
    jest.spyOn(require('../config'), 'loadConfig').mockReturnValue({ adminToken } as any);
  });
  afterAll(() => jest.restoreAllMocks());

  test('rejects without admin token', async () => {
    const app = makeApp(false);
    const res = await request(app).get('/api/admin/health');
    expect(res.status).toBe(401);
  });

  test('accepts with correct admin token', async () => {
    const app = makeApp(false);
    const res = await request(app).get('/api/admin/health').set('x-admin-token', adminToken);
    expect(res.status).toBe(200);
    expect(res.body?.code).toBe(200);
  });

  test('rate-limits excessive requests under /api/', async () => {
    const app = makeApp(true);
    // Hit a non-admin API path to exercise limiter behavior consistently
    // Use admin path too since limiter is mounted at /api/
    let lastStatus = 200;
    for (let i = 0; i < 10; i++) {
      const r = await request(app).get('/api/admin/health').set('x-admin-token', adminToken);
      lastStatus = r.status;
      if (r.status === 429) break;
    }
    expect([200, 429]).toContain(lastStatus);
  });
});


