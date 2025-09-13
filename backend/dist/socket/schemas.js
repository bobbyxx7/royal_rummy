"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getDropCardSchema = exports.getCardSchema = exports.packGameSchema = exports.declareSchema = exports.groupCardsSchema = exports.discardSchema = exports.statusSchema = exports.joinTableSchema = exports.getTableSchema = exports.cardSchema = void 0;
const zod_1 = require("zod");
exports.cardSchema = zod_1.z.object({
    isJoker: zod_1.z.boolean().optional(),
    suit: zod_1.z.enum(['hearts', 'spades', 'clubs', 'diamonds']).optional(),
    rank: zod_1.z.union([zod_1.z.string(), zod_1.z.number()]).optional(),
});
exports.getTableSchema = zod_1.z.object({
    user_id: zod_1.z.string().min(1).optional(),
    token: zod_1.z.string().min(1).optional(),
    boot_value: zod_1.z.union([zod_1.z.string(), zod_1.z.number()]).optional(),
    no_of_players: zod_1.z.union([zod_1.z.string(), zod_1.z.number()]).optional(),
    format: zod_1.z.enum(['points', 'deals', 'pool']).optional(),
    idempotencyKey: zod_1.z.string().optional(),
});
exports.joinTableSchema = zod_1.z.object({
    user_id: zod_1.z.string().min(1),
    token: zod_1.z.string().min(1).optional(),
    table_id: zod_1.z.string().min(1),
    idempotencyKey: zod_1.z.string().optional(),
});
exports.statusSchema = zod_1.z.object({
    game_id: zod_1.z.string().min(1),
    user_id: zod_1.z.string().optional(),
    token: zod_1.z.string().optional(),
});
exports.discardSchema = zod_1.z.object({
    card: exports.cardSchema,
    idempotencyKey: zod_1.z.string().optional(),
});
exports.groupCardsSchema = zod_1.z.object({
    groups: zod_1.z.array(zod_1.z.array(zod_1.z.string())).default([]),
    idempotencyKey: zod_1.z.string().optional(),
});
exports.declareSchema = zod_1.z.object({
    groups: zod_1.z.array(zod_1.z.array(zod_1.z.string())).default([]),
    finish_card: zod_1.z.union([exports.cardSchema, zod_1.z.string()]).optional(),
    idempotencyKey: zod_1.z.string().optional(),
});
exports.packGameSchema = zod_1.z.object({
    game_id: zod_1.z.string().optional(),
    idempotencyKey: zod_1.z.string().optional(),
});
exports.getCardSchema = zod_1.z.object({
    idempotencyKey: zod_1.z.string().optional(),
});
exports.getDropCardSchema = zod_1.z.object({
    idempotencyKey: zod_1.z.string().optional(),
});
