import { reconcileWallets } from '../services/reconcile';

jest.mock('../db', () => ({
  UserModel: { find: jest.fn().mockReturnValue({ select: jest.fn().mockReturnValue({ limit: jest.fn().mockReturnValue({ lean: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue([
    { _id: 'u1', wallet: '10.00' },
    { _id: 'u2', wallet: '5.50' },
  ]) }) }) }) }) },
  WalletLedgerModel: { aggregate: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue([
    { _id: 'u1', totalDelta: 12.5 },
    { _id: 'u2', totalDelta: 0 },
  ]) }) },
  WalletHoldModel: { aggregate: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue([
    { _id: 'u1', totalHold: 2.0 },
    { _id: 'u2', totalHold: 0 },
  ]) }) },
}));

describe('reconcileWallets', () => {
  test('computes expected and diff per user', async () => {
    const res = await reconcileWallets(10);
    expect(res.count).toBe(2);
    const u1 = res.sample.find(r => r.userId === 'u1')!;
    expect(u1.expected).toBe(10.5); // 12.5 - 2.0
    expect(u1.wallet).toBe(10);
    expect(Number(u1.diff.toFixed(2))).toBe(-0.5);
  });
});


