import request from 'supertest';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { adminRouter } from '../services/admin.routes';

function makeApp() {
  const app = express();
  app.use(helmet());
  app.use(cors());
  app.use(express.json());
  app.use('/api/admin', adminRouter);
  return app;
}

describe('Admin health endpoint', () => {
  const adminToken = 'admintoken';
  beforeAll(() => {
    jest.spyOn(require('../config'), 'loadConfig').mockReturnValue({ adminToken } as any);
  });
  afterAll(() => jest.restoreAllMocks());
  test('GET /health returns basic stats', async () => {
    const app = makeApp();
    const res = await request(app).get('/api/admin/health').set('x-admin-token', adminToken);
    expect(res.status).toBe(200);
    expect(res.body?.data).toHaveProperty('db');
    expect(res.body?.data).toHaveProperty('tables');
    expect(res.body?.data).toHaveProperty('games');
    expect(res.body?.data).toHaveProperty('upMs');
  });
});


