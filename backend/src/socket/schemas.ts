import { z } from 'zod';

export const cardSchema = z.object({
  isJoker: z.boolean().optional(),
  suit: z.enum(['hearts', 'spades', 'clubs', 'diamonds']).optional(),
  rank: z.union([z.string(), z.number()]).optional(),
});

export const getTableSchema = z.object({
  user_id: z.string().min(1).optional(),
  token: z.string().min(1).optional(),
  boot_value: z.union([z.string(), z.number()]).optional(),
  no_of_players: z.union([z.string(), z.number()]).optional(),
  format: z.enum(['points', 'deals', 'pool']).optional(),
  idempotencyKey: z.string().optional(),
});

export const joinTableSchema = z.object({
  user_id: z.string().min(1),
  token: z.string().min(1).optional(),
  table_id: z.string().min(1),
  idempotencyKey: z.string().optional(),
});

export const statusSchema = z.object({
  game_id: z.string().min(1),
  user_id: z.string().optional(),
  token: z.string().optional(),
});

export const discardSchema = z.object({
  card: cardSchema,
  idempotencyKey: z.string().optional(),
});

export const groupCardsSchema = z.object({
  groups: z.array(z.array(z.string())).default([]),
  idempotencyKey: z.string().optional(),
});

export const declareSchema = z.object({
  groups: z.array(z.array(z.string())).default([]),
  finish_card: z.union([cardSchema, z.string()]).optional(),
  idempotencyKey: z.string().optional(),
});

export const packGameSchema = z.object({
  game_id: z.string().optional(),
  idempotencyKey: z.string().optional(),
});

export const getCardSchema = z.object({
  idempotencyKey: z.string().optional(),
});

export const getDropCardSchema = z.object({
  idempotencyKey: z.string().optional(),
});


