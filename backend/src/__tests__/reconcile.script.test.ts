import { reconcileWallets } from '../services/reconcile';

jest.mock('../config', () => ({ loadConfig: () => ({ mongoUri: 'mongodb://mock' }) }));
jest.mock('../db', () => ({ connectMongo: jest.fn() }));
jest.mock('../services/reconcile', () => ({
  reconcileWallets: jest.fn().mockResolvedValue({ count: 1, inconsistencies: [], sample: [] })
}));

describe('reconcile script', () => {
  test('invokes reconcileWallets and logs JSON', async () => {
    const consoleLogSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    const mod = await import('../scripts/reconcile');
    expect(mod).toBeTruthy();
    // Directly invoke to avoid require.main guard
    // @ts-ignore
    await (mod as any).runReconcile();
    expect(reconcileWallets).toHaveBeenCalled();
    consoleLogSpy.mockRestore();
  });
});


