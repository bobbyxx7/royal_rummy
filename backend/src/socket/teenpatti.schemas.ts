import { z } from 'zod';

// Common validation patterns
const userIdSchema = z.string().min(1, 'User ID is required');
const tokenSchema = z.string().min(1, 'Token is required');
const tableIdSchema = z.string().min(1, 'Table ID is required');
const bootValueSchema = z.string().regex(/^\d+$/, 'Boot value must be a positive number');
const playerCountSchema = z.number().int().min(2).max(6, 'Player count must be between 2 and 6');

// Get table request schema
export const getTeenPattiTableSchema = z.object({
  user_id: userIdSchema,
  token: tokenSchema.optional(), // Optional if already authenticated
  boot_value: bootValueSchema.optional().default('100'),
  no_of_players: playerCountSchema.optional().default(2)
});

// Join table request schema
export const joinTeenPattiTableSchema = z.object({
  user_id: userIdSchema,
  token: tokenSchema.optional(), // Optional if already authenticated
  table_id: tableIdSchema
});

// Start game request schema
export const startTeenPattiGameSchema = z.object({
  table_id: tableIdSchema
});

// Bet action schema (for future betting events)
export const teenPattiBetSchema = z.object({
  action: z.enum(['call', 'raise', 'pack', 'show']),
  amount: z.number().int().min(0).optional(), // Required for raise, optional for others
  target_player_id: z.string().optional() // Required for show action
});

// Game action schema (for future game events)
export const teenPattiGameActionSchema = z.object({
  game_id: z.string().min(1, 'Game ID is required'),
  action: z.enum(['deal', 'bet', 'show', 'pack', 'end-round']),
  data: z.record(z.any()).optional() // Flexible data for different actions
});

// Response schemas for validation
export const teenPattiResponseSchema = z.object({
  code: z.number(),
  message: z.string(),
  data: z.record(z.any()).optional()
});

// Table info schema
export const teenPattiTableInfoSchema = z.object({
  id: z.string(),
  bootValue: z.string(),
  noOfPlayers: z.number(),
  status: z.enum(['waiting', 'playing', 'finished']),
  players: z.array(z.string()),
  createdAt: z.number(),
  currentGameId: z.string().optional()
});

// Player info schema
export const teenPattiPlayerInfoSchema = z.object({
  userId: z.string(),
  seatNo: z.number(),
  isBot: z.boolean(),
  isConnected: z.boolean(),
  currentBet: z.number().optional(),
  hasFolded: z.boolean().optional(),
  lastAction: z.string().optional()
});

// Game state schema
export const teenPattiGameStateSchema = z.object({
  id: z.string(),
  tableId: z.string(),
  phase: z.enum(['waiting', 'dealing', 'blind-betting', 'seen-betting', 'showdown', 'finished']),
  players: z.array(teenPattiPlayerInfoSchema),
  currentTurn: z.number().optional(),
  pot: z.number(),
  deck: z.array(z.string()),
  communityCards: z.array(z.string()).optional(),
  roundNumber: z.number(),
  dealer: z.number(),
  lastAction: z.record(z.any()).optional()
});

// Export types for use in other files
export type GetTeenPattiTableRequest = z.infer<typeof getTeenPattiTableSchema>;
export type JoinTeenPattiTableRequest = z.infer<typeof joinTeenPattiTableSchema>;
export type StartTeenPattiGameRequest = z.infer<typeof startTeenPattiGameSchema>;
export type TeenPattiBetRequest = z.infer<typeof teenPattiBetSchema>;
export type TeenPattiGameActionRequest = z.infer<typeof teenPattiGameActionSchema>;
export type TeenPattiTableInfo = z.infer<typeof teenPattiTableInfoSchema>;
export type TeenPattiPlayerInfo = z.infer<typeof teenPattiPlayerInfoSchema>;
export type TeenPattiGameState = z.infer<typeof teenPattiGameStateSchema>;
