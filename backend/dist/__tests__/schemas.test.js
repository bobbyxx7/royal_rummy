"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const schemas_1 = require("../socket/schemas");
describe('socket schema validation', () => {
    test('get-table valid', () => {
        const res = schemas_1.getTableSchema.safeParse({ boot_value: '80', no_of_players: 2 });
        expect(res.success).toBe(true);
    });
    test('join-table requires ids', () => {
        const res = schemas_1.joinTableSchema.safeParse({});
        expect(res.success).toBe(false);
    });
    test('status requires game_id', () => {
        const ok = schemas_1.statusSchema.safeParse({ game_id: 'g' });
        expect(ok.success).toBe(true);
    });
    test('discard requires card', () => {
        const bad = schemas_1.discardSchema.safeParse({});
        expect(bad.success).toBe(false);
    });
    test('group-cards accepts default empty', () => {
        const ok = schemas_1.groupCardsSchema.safeParse({});
        expect(ok.success).toBe(true);
        if (ok.success)
            expect(ok.data.groups).toBeDefined();
    });
    test('declare needs groups and optional finish_card', () => {
        const ok = schemas_1.declareSchema.safeParse({ groups: [['RP7', 'RP8', 'RP9']] });
        expect(ok.success).toBe(true);
    });
});
