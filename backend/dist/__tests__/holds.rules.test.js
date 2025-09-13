"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const finance_1 = require("../socket/finance");
const rules_config_1 = require("../socket/rules.config");
describe('computeReserveHold', () => {
    const rules = (0, rules_config_1.loadRulesConfig)();
    test('points: reserve is max(boot, maxPoints*pointValue)', () => {
        const table = { id: 't', bootValue: '80', pointValue: 1, format: 'points' };
        const reserve = (0, finance_1.computeReserveHold)(table, rules);
        expect(reserve).toBe(Math.max(80, rules.maxPoints * (table.pointValue || rules.pointValue)));
    });
    test('deals: reserve is boot only', () => {
        const table = { id: 't', bootValue: '500', pointValue: 1, format: 'deals' };
        const reserve = (0, finance_1.computeReserveHold)(table, rules);
        expect(reserve).toBe(500);
    });
    test('pool: reserve is boot + one points reserve', () => {
        const table = { id: 't', bootValue: '200', pointValue: 2, format: 'pool' };
        const expected = 200 + rules.maxPoints * (table.pointValue || rules.pointValue);
        const reserve = (0, finance_1.computeReserveHold)(table, rules);
        expect(reserve).toBe(expected);
    });
});
