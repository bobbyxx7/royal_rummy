import { ledgersToCsv, rakeSummary } from '../services/export';
import { WalletLedgerModel, RoundResultModel } from '../db';

describe('Export services', () => {
  test('ledgersToCsv returns CSV with header', async () => {
    (WalletLedgerModel.find as any) = jest.fn().mockReturnValue({ sort: () => ({ lean: () => ({ exec: async () => ([
      { userId: 'u1', delta: 10, reason: 'hold', ref: 'r1', balanceAfter: '100.00', createdAt: new Date('2024-01-01T00:00:00Z') },
    ]) }) }) });
    const csv = await ledgersToCsv();
    expect(csv.split('\n')[0]).toContain('userId');
    expect(csv).toContain('u1');
  });

  test('rakeSummary aggregates totals', async () => {
    (RoundResultModel.aggregate as any) = jest.fn().mockReturnValue({ exec: async () => ([{ totalRake: 5, rounds: 2 }]) });
    const res = await rakeSummary();
    expect(res.totalRake).toBe(5);
    expect(res.rounds).toBe(2);
  });
});


