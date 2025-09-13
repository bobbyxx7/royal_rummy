"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const deals_1 = require("../socket/deals");
describe('deals state helpers', () => {
    test('accumulates points and resolves after remaining deals', () => {
        const st0 = (0, deals_1.createInitialDealsState)(2);
        const st1 = (0, deals_1.applyRoundToDealsState)(st0, [
            { user_id: 'w', points: 0 },
            { user_id: 'l1', points: 10 },
            { user_id: 'l2', points: 20 },
        ], 'w');
        expect(st1.remaining).toBe(1);
        expect(st1.cumulative['l1']).toBe(10);
        expect(st1.cumulative['l2']).toBe(20);
        expect((0, deals_1.isDealsMatchOver)(st1)).toBe(false);
        const st2 = (0, deals_1.applyRoundToDealsState)(st1, [
            { user_id: 'w', points: 0 },
            { user_id: 'l1', points: 30 },
            { user_id: 'l2', points: 5 },
        ], 'w');
        expect(st2.remaining).toBe(0);
        expect(st2.cumulative['l1']).toBe(40);
        expect(st2.cumulative['l2']).toBe(25);
        expect((0, deals_1.isDealsMatchOver)(st2)).toBe(true);
        expect((0, deals_1.getDealsWinnerByMinPoints)(st2)).toBe('w');
    });
});
