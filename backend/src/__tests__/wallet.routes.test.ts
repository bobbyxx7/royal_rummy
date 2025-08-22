import request from 'supertest';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { walletRouter } from '../services/wallet.routes';
import * as auth from '../auth';

function makeApp() {
  const app = express();
  app.use(helmet());
  app.use(cors());
  app.use(express.json());
  app.use('/api/wallet', walletRouter);
  return app;
}

describe('Wallet routes', () => {
  beforeAll(() => {
    jest.spyOn(auth, 'validateUserToken').mockResolvedValue(true);
    jest.spyOn(auth, 'isDbConnected').mockReturnValue(false as any);
  });

  test('GET /balance requires user_id', async () => {
    const app = makeApp();
    const res = await request(app).get('/api/wallet/balance');
    expect(res.status).toBe(400);
  });

  test('GET /balance returns value', async () => {
    const app = makeApp();
    const res = await request(app).get('/api/wallet/balance').set('x-user-id', 'u1').set('x-user-token', 't');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('wallet');
  });
});


