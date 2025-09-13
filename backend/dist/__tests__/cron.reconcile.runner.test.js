"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const reconcile_1 = require("../services/reconcile");
// Simulated cron runner
async function runCronOnce(limit = 100) {
    return await (0, reconcile_1.reconcileWallets)(limit);
}
describe('Scheduled reconciliation runner (simulated)', () => {
    test('invokes reconcile service with limit', async () => {
        reconcile_1.reconcileWallets = jest.fn().mockResolvedValue({ count: 0, inconsistencies: [], sample: [] });
        const res = await runCronOnce(50);
        expect(reconcile_1.reconcileWallets).toHaveBeenCalledWith(50);
        expect(res).toHaveProperty('count');
    });
});
