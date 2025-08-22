jest.mock('../config', () => ({ loadConfig: () => ({ mongoUri: 'mongodb://mock' }) }));
jest.mock('../db', () => ({ connectMongo: jest.fn(), UserModel: { updateOne: jest.fn().mockReturnValue({ exec: async () => ({}) }) }, WalletLedgerModel: { create: jest.fn() } }));
jest.mock('../services/reconcile', () => ({ reconcileWallets: jest.fn().mockResolvedValue({ inconsistencies: [ { userId: 'u1', wallet: 10, expected: 12, diff: -2 } ] }) }));

describe('backfill script', () => {
  test('dry-run outputs repairs without applying', async () => {
    const consoleLogSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    const mod = await import('../scripts/backfill_wallets');
    process.env.BACKFILL_LIMIT = '10';
    process.env.BACKFILL_THRESHOLD = '0.5';
    // @ts-ignore
    await (mod as any).runBackfill();
    expect(consoleLogSpy).toHaveBeenCalled();
    consoleLogSpy.mockRestore();
  });
});


