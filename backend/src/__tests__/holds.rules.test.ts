import { computeReserveHold } from '../socket/finance';
import { loadRulesConfig } from '../socket/rules.config';

describe('computeReserveHold', () => {
  const rules = loadRulesConfig();

  test('points: reserve is max(boot, maxPoints*pointValue)', () => {
    const table: any = { id: 't', bootValue: '80', pointValue: 1, format: 'points' };
    const reserve = computeReserveHold(table as any, rules);
    expect(reserve).toBe(Math.max(80, rules.maxPoints * (table.pointValue || rules.pointValue)));
  });

  test('deals: reserve is boot only', () => {
    const table: any = { id: 't', bootValue: '500', pointValue: 1, format: 'deals' };
    const reserve = computeReserveHold(table as any, rules);
    expect(reserve).toBe(500);
  });

  test('pool: reserve is boot + one points reserve', () => {
    const table: any = { id: 't', bootValue: '200', pointValue: 2, format: 'pool' };
    const expected = 200 + rules.maxPoints * (table.pointValue || rules.pointValue);
    const reserve = computeReserveHold(table as any, rules);
    expect(reserve).toBe(expected);
  });
});


