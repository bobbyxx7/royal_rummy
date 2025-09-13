"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.teenPattiGameStateSchema = exports.teenPattiPlayerInfoSchema = exports.teenPattiTableInfoSchema = exports.teenPattiResponseSchema = exports.teenPattiGameActionSchema = exports.teenPattiBetSchema = exports.startTeenPattiGameSchema = exports.joinTeenPattiTableSchema = exports.getTeenPattiTableSchema = void 0;
const zod_1 = require("zod");
// Common validation patterns
const userIdSchema = zod_1.z.string().min(1, 'User ID is required');
const tokenSchema = zod_1.z.string().min(1, 'Token is required');
const tableIdSchema = zod_1.z.string().min(1, 'Table ID is required');
const bootValueSchema = zod_1.z.string().regex(/^\d+$/, 'Boot value must be a positive number');
const playerCountSchema = zod_1.z.number().int().min(2).max(6, 'Player count must be between 2 and 6');
// Get table request schema
exports.getTeenPattiTableSchema = zod_1.z.object({
    user_id: userIdSchema,
    token: tokenSchema.optional(), // Optional if already authenticated
    boot_value: bootValueSchema.optional().default('100'),
    no_of_players: playerCountSchema.optional().default(2)
});
// Join table request schema
exports.joinTeenPattiTableSchema = zod_1.z.object({
    user_id: userIdSchema,
    token: tokenSchema.optional(), // Optional if already authenticated
    table_id: tableIdSchema
});
// Start game request schema
exports.startTeenPattiGameSchema = zod_1.z.object({
    table_id: tableIdSchema
});
// Bet action schema (for future betting events)
exports.teenPattiBetSchema = zod_1.z.object({
    action: zod_1.z.enum(['call', 'raise', 'pack', 'show']),
    amount: zod_1.z.number().int().min(0).optional(), // Required for raise, optional for others
    target_player_id: zod_1.z.string().optional() // Required for show action
});
// Game action schema (for future game events)
exports.teenPattiGameActionSchema = zod_1.z.object({
    game_id: zod_1.z.string().min(1, 'Game ID is required'),
    action: zod_1.z.enum(['deal', 'bet', 'show', 'pack', 'end-round']),
    data: zod_1.z.record(zod_1.z.any()).optional() // Flexible data for different actions
});
// Response schemas for validation
exports.teenPattiResponseSchema = zod_1.z.object({
    code: zod_1.z.number(),
    message: zod_1.z.string(),
    data: zod_1.z.record(zod_1.z.any()).optional()
});
// Table info schema
exports.teenPattiTableInfoSchema = zod_1.z.object({
    id: zod_1.z.string(),
    bootValue: zod_1.z.string(),
    noOfPlayers: zod_1.z.number(),
    status: zod_1.z.enum(['waiting', 'playing', 'finished']),
    players: zod_1.z.array(zod_1.z.string()),
    createdAt: zod_1.z.number(),
    currentGameId: zod_1.z.string().optional()
});
// Player info schema
exports.teenPattiPlayerInfoSchema = zod_1.z.object({
    userId: zod_1.z.string(),
    seatNo: zod_1.z.number(),
    isBot: zod_1.z.boolean(),
    isConnected: zod_1.z.boolean(),
    currentBet: zod_1.z.number().optional(),
    hasFolded: zod_1.z.boolean().optional(),
    lastAction: zod_1.z.string().optional()
});
// Game state schema
exports.teenPattiGameStateSchema = zod_1.z.object({
    id: zod_1.z.string(),
    tableId: zod_1.z.string(),
    phase: zod_1.z.enum(['waiting', 'dealing', 'blind-betting', 'seen-betting', 'showdown', 'finished']),
    players: zod_1.z.array(exports.teenPattiPlayerInfoSchema),
    currentTurn: zod_1.z.number().optional(),
    pot: zod_1.z.number(),
    deck: zod_1.z.array(zod_1.z.string()),
    communityCards: zod_1.z.array(zod_1.z.string()).optional(),
    roundNumber: zod_1.z.number(),
    dealer: zod_1.z.number(),
    lastAction: zod_1.z.record(zod_1.z.any()).optional()
});
