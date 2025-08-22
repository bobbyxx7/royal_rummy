import { applyRoundToDealsState, createInitialDealsState, isDealsMatchOver, getDealsWinnerByMinPoints } from '../socket/deals';

describe('deals state helpers', () => {
  test('accumulates points and resolves after remaining deals', () => {
    const st0 = createInitialDealsState(2);
    const st1 = applyRoundToDealsState(st0, [
      { user_id: 'w', points: 0 },
      { user_id: 'l1', points: 10 },
      { user_id: 'l2', points: 20 },
    ], 'w');
    expect(st1.remaining).toBe(1);
    expect(st1.cumulative['l1']).toBe(10);
    expect(st1.cumulative['l2']).toBe(20);
    expect(isDealsMatchOver(st1)).toBe(false);
    const st2 = applyRoundToDealsState(st1, [
      { user_id: 'w', points: 0 },
      { user_id: 'l1', points: 30 },
      { user_id: 'l2', points: 5 },
    ], 'w');
    expect(st2.remaining).toBe(0);
    expect(st2.cumulative['l1']).toBe(40);
    expect(st2.cumulative['l2']).toBe(25);
    expect(isDealsMatchOver(st2)).toBe(true);
    expect(getDealsWinnerByMinPoints(st2)).toBe('w');
  });
});


