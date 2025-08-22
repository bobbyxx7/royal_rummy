import request from 'supertest';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { walletRouter } from '../services/wallet.routes';
import * as auth from '../auth';
import { WalletLedgerModel } from '../db';

function makeApp() {
  const app = express();
  app.use(helmet());
  app.use(cors());
  app.use(express.json());
  app.use('/api/wallet', walletRouter);
  return app;
}

describe('Wallet ledger route', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    jest.spyOn(auth, 'validateUserToken').mockResolvedValue(true);
  });

  test('returns empty array when DB disconnected', async () => {
    jest.spyOn(auth, 'isDbConnected').mockReturnValue(false as any);
    const app = makeApp();
    const res = await request(app)
      .get('/api/wallet/ledger')
      .query({ limit: 10, skip: 0 })
      .set('x-user-id', 'u1')
      .set('x-user-token', 't');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  test('returns rows when DB connected', async () => {
    jest.spyOn(auth, 'isDbConnected').mockReturnValue(true as any);
    const rows = [
      { userId: 'u1', delta: 10, reason: 'round_settlement', ref: 'g1', balanceAfter: '10.00', createdAt: new Date() },
    ];
    const findSpy = jest.spyOn(WalletLedgerModel, 'find').mockReturnValue({
      sort: () => ({
        skip: () => ({
          limit: () => ({
            lean: () => ({
              exec: async () => rows,
            }),
          }),
        }),
      }),
    } as any);
    const app = makeApp();
    const res = await request(app)
      .get('/api/wallet/ledger')
      .query({ limit: 10, skip: 0 })
      .set('x-user-id', 'u1')
      .set('x-user-token', 't');
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBe(1);
    expect(res.body.data[0].reason).toBe('round_settlement');
    expect(findSpy).toHaveBeenCalledWith({ userId: 'u1' });
  });
});


