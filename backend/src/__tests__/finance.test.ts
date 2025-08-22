import { computeRoundDeltasByFormat, RoundDelta } from '../socket/finance';
import { loadRulesConfig } from '../socket/rules.config';

describe('finance: computeRoundDeltasByFormat', () => {
  const rules = loadRulesConfig();

  test('points format: winner gets sum(losers points)*pointValue and losers pay their points', () => {
    const table: any = { id: 't1', pointValue: 1, format: 'points' };
    const players = ['w', 'l1', 'l2'];
    const packed = [false, false, false];
    // Winner hand ignored; losers each have a 10-point card
    const playersHands = [[], ['BPA'], ['BP10']];
    const playersGroups: string[][][] = [[], [], []];
    const winner = 'w';
    const { deltas, rakePercent } = computeRoundDeltasByFormat(
      table as any,
      players,
      packed,
      playersHands,
      playersGroups,
      winner,
      undefined,
      rules,
    );
    // Points should be 0 for winner, 10 for each loser
    const pointsByUser: Record<string, number> = Object.fromEntries(deltas.map(d => [d.user_id, d.points]));
    expect(pointsByUser['w']).toBe(0);
    expect(pointsByUser['l1']).toBe(10);
    expect(pointsByUser['l2']).toBe(10);
    // Deltas: winner +20, losers -10 each (rake zero in tests by default)
    const deltaByUser: Record<string, number> = Object.fromEntries(deltas.map(d => [d.user_id, d.delta]));
    expect(deltaByUser['w']).toBe(20);
    expect(deltaByUser['l1']).toBe(-10);
    expect(deltaByUser['l2']).toBe(-10);
    expect(typeof rakePercent).toBe('number');
  });

  test('deals format: points computed; deltas zero (settlement handled at match end)', () => {
    const table: any = { id: 't1', pointValue: 1, format: 'deals' };
    const players = ['w', 'l1', 'l2'];
    const packed = [false, false, false];
    const playersHands = [[], ['BPA'], ['BP10']];
    const playersGroups: string[][][] = [[], [], []];
    const winner = 'w';
    const { deltas } = computeRoundDeltasByFormat(
      table as any,
      players,
      packed,
      playersHands,
      playersGroups,
      winner,
      undefined,
      rules,
    );
    const pointsByUser: Record<string, number> = Object.fromEntries(deltas.map(d => [d.user_id, d.points]));
    expect(pointsByUser['l1']).toBe(10);
    expect(pointsByUser['l2']).toBe(10);
    // All deltas zero
    deltas.forEach((d: RoundDelta) => expect(d.delta).toBe(0));
  });

  test('pool format: points computed; deltas zero (elimination/settlement outside)', () => {
    const table: any = { id: 't1', pointValue: 1, format: 'pool' };
    const players = ['w', 'l1', 'l2'];
    const packed = [false, false, false];
    const playersHands = [[], ['BPA'], ['BP10']];
    const playersGroups: string[][][] = [[], [], []];
    const winner = 'w';
    const { deltas } = computeRoundDeltasByFormat(
      table as any,
      players,
      packed,
      playersHands,
      playersGroups,
      winner,
      undefined,
      rules,
    );
    const pointsByUser: Record<string, number> = Object.fromEntries(deltas.map(d => [d.user_id, d.points]));
    expect(pointsByUser['l1']).toBe(10);
    expect(pointsByUser['l2']).toBe(10);
    deltas.forEach((d: RoundDelta) => expect(d.delta).toBe(0));
  });
});


