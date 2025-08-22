import request from 'supertest';
import express from 'express';
import { metricsRouter } from '../services/metrics.routes';

describe('Metrics endpoint', () => {
  test('returns text/plain metrics', async () => {
    const app = express();
    app.use('/api', metricsRouter);
    const res = await request(app).get('/api/metrics');
    expect(res.status).toBe(200);
    expect(res.type).toMatch(/text\/plain/);
    expect(res.text).toMatch(/rummy_active_games/);
  });
});


