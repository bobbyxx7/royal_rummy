import 'dotenv/config';
import { z } from 'zod';

export type AppConfig = {
  port: number;
  baseUrl: string;
  clientOrigin: string;
  mongoUri?: string;
  mongoDb: string;
  adminToken?: string;
  pointValue: number;
  maxPoints: number;
  firstDrop: number;
  middleDrop: number;
  rakePercent: number; // 0-100
  reconnectGraceMs: number;
  rateLimitWindowMs: number;
  rateLimitMax: number;
};

export function loadConfig(): AppConfig {
  const nodeEnv = process.env.NODE_ENV || 'development';
  const EnvSchema = z.object({
    PORT: z.string().optional(),
    BASE_URL: z.string().optional(),
    CLIENT_ORIGIN: z.string().optional(),
    MONGO_URI: z.string().optional(),
    MONGO_DB: z.string().default('rummy'),
    ADMIN_TOKEN: z.string().optional(),
    POINT_VALUE: z.string().optional(),
    MAX_POINTS: z.string().optional(),
    FIRST_DROP: z.string().optional(),
    MIDDLE_DROP: z.string().optional(),
    RAKE_PERCENT: z.string().optional(),
    RECONNECT_GRACE_MS: z.string().optional(),
    RATE_LIMIT_WINDOW_MS: z.string().optional(),
    RATE_LIMIT_MAX: z.string().optional(),
    JWT_SECRET: z.string().optional(),
  }).passthrough();
  const env = EnvSchema.parse(process.env);
  const cfg: AppConfig = {
    port: Number(env.PORT || 6969),
    baseUrl: env.BASE_URL || `http://localhost:${env.PORT || 6969}`,
    clientOrigin: env.CLIENT_ORIGIN || '*',
    mongoUri: env.MONGO_URI || undefined,
    mongoDb: env.MONGO_DB || 'rummy',
    adminToken: env.ADMIN_TOKEN || undefined,
    pointValue: Number(env.POINT_VALUE || 1),
    maxPoints: Number(env.MAX_POINTS || 80),
    firstDrop: Number(env.FIRST_DROP || 20),
    middleDrop: Number(env.MIDDLE_DROP || 40),
    rakePercent: Math.max(0, Math.min(100, Number(env.RAKE_PERCENT || 0))),
    reconnectGraceMs: Math.max(5000, Number(env.RECONNECT_GRACE_MS || 15000)),
    rateLimitWindowMs: Math.max(1000, Number(env.RATE_LIMIT_WINDOW_MS || 5 * 60 * 1000)),
    rateLimitMax: Math.max(10, Number(env.RATE_LIMIT_MAX || 100)),
  };
  if (nodeEnv === 'production') {
    if (!cfg.mongoUri) throw new Error('MONGO_URI is required in production');
    if (!cfg.adminToken) throw new Error('ADMIN_TOKEN is required in production');
    if (!env.JWT_SECRET) throw new Error('JWT_SECRET is required in production');
  }
  return cfg;
}


