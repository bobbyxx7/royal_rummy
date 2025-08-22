import { reconcileWallets } from '../services/reconcile';

// Simulated cron runner
async function runCronOnce(limit = 100) {
  return await reconcileWallets(limit);
}

describe('Scheduled reconciliation runner (simulated)', () => {
  test('invokes reconcile service with limit', async () => {
    (reconcileWallets as unknown as jest.Mock) = jest.fn().mockResolvedValue({ count: 0, inconsistencies: [], sample: [] });
    const res = await runCronOnce(50);
    expect(reconcileWallets).toHaveBeenCalledWith(50);
    expect(res).toHaveProperty('count');
  });
});


