import { applyRoundToPoolState, createInitialPoolState, getRemainingPlayers, isPoolMatchOver, getPoolWinner } from '../socket/pool';

describe('pool state helpers', () => {
  test('accumulates points and eliminates at threshold', () => {
    const st0 = createInitialPoolState(101);
    const players = ['a', 'b', 'c'];
    // Round 1: a wins (b: 20, c: 40)
    const st1 = applyRoundToPoolState(st0, [ { user_id: 'a', points: 0 }, { user_id: 'b', points: 20 }, { user_id: 'c', points: 40 } ], 'a');
    expect(st1.cumulative['a']).toBe(0);
    expect(st1.cumulative['b']).toBe(20);
    expect(st1.cumulative['c']).toBe(40);
    expect(getRemainingPlayers(players, st1)).toEqual(['a','b','c']);
    expect(isPoolMatchOver(players, st1)).toBe(false);
    // Round 2: b wins (a: 50, c: 70)
    const st2 = applyRoundToPoolState(st1, [ { user_id: 'a', points: 50 }, { user_id: 'b', points: 0 }, { user_id: 'c', points: 70 } ], 'b');
    expect(st2.cumulative['a']).toBe(50);
    expect(st2.cumulative['b']).toBe(20);
    expect(st2.cumulative['c']).toBe(110);
    expect(st2.eliminated.has('c')).toBe(true);
    expect(getRemainingPlayers(players, st2)).toEqual(['a','b']);
    expect(isPoolMatchOver(players, st2)).toBe(false);
    // Round 3: a wins (b: 90)
    const st3 = applyRoundToPoolState(st2, [ { user_id: 'a', points: 0 }, { user_id: 'b', points: 90 } ], 'a');
    expect(st3.cumulative['b']).toBe(110);
    expect(st3.eliminated.has('b')).toBe(true);
    expect(getRemainingPlayers(players, st3)).toEqual(['a']);
    expect(isPoolMatchOver(players, st3)).toBe(true);
    expect(getPoolWinner(players, st3)).toBe('a');
  });
});


