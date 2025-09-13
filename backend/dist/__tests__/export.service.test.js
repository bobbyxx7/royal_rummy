"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const export_1 = require("../services/export");
const db_1 = require("../db");
describe('Export services', () => {
    test('ledgersToCsv returns CSV with header', async () => {
        db_1.WalletLedgerModel.find = jest.fn().mockReturnValue({ sort: () => ({ lean: () => ({ exec: async () => ([
                        { userId: 'u1', delta: 10, reason: 'hold', ref: 'r1', balanceAfter: '100.00', createdAt: new Date('2024-01-01T00:00:00Z') },
                    ]) }) }) });
        const csv = await (0, export_1.ledgersToCsv)();
        expect(csv.split('\n')[0]).toContain('userId');
        expect(csv).toContain('u1');
    });
    test('rakeSummary aggregates totals', async () => {
        db_1.RoundResultModel.aggregate = jest.fn().mockReturnValue({ exec: async () => ([{ totalRake: 5, rounds: 2 }]) });
        const res = await (0, export_1.rakeSummary)();
        expect(res.totalRake).toBe(5);
        expect(res.rounds).toBe(2);
    });
});
