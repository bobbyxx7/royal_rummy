import { getTableSchema, joinTableSchema, statusSchema, discardSchema, groupCardsSchema, declareSchema } from '../socket/schemas';

describe('socket schema validation', () => {
  test('get-table valid', () => {
    const res = getTableSchema.safeParse({ boot_value: '80', no_of_players: 2 });
    expect(res.success).toBe(true);
  });

  test('join-table requires ids', () => {
    const res = joinTableSchema.safeParse({});
    expect(res.success).toBe(false);
  });

  test('status requires game_id', () => {
    const ok = statusSchema.safeParse({ game_id: 'g' });
    expect(ok.success).toBe(true);
  });

  test('discard requires card', () => {
    const bad = discardSchema.safeParse({});
    expect(bad.success).toBe(false);
  });

  test('group-cards accepts default empty', () => {
    const ok = groupCardsSchema.safeParse({});
    expect(ok.success).toBe(true);
    if (ok.success) expect(ok.data.groups).toBeDefined();
  });

  test('declare needs groups and optional finish_card', () => {
    const ok = declareSchema.safeParse({ groups: [['RP7', 'RP8', 'RP9']] });
    expect(ok.success).toBe(true);
  });
});


