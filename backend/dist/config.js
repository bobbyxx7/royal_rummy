"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.loadConfig = loadConfig;
require("dotenv/config");
const zod_1 = require("zod");
function loadConfig() {
    const nodeEnv = process.env.NODE_ENV || 'development';
    const EnvSchema = zod_1.z.object({
        PORT: zod_1.z.string().optional(),
        BASE_URL: zod_1.z.string().optional(),
        CLIENT_ORIGIN: zod_1.z.string().optional(),
        MONGO_URI: zod_1.z.string().optional(),
        MONGO_DB: zod_1.z.string().default('rummy'),
        ADMIN_TOKEN: zod_1.z.string().optional(),
        POINT_VALUE: zod_1.z.string().optional(),
        MAX_POINTS: zod_1.z.string().optional(),
        FIRST_DROP: zod_1.z.string().optional(),
        MIDDLE_DROP: zod_1.z.string().optional(),
        RAKE_PERCENT: zod_1.z.string().optional(),
        RECONNECT_GRACE_MS: zod_1.z.string().optional(),
        RATE_LIMIT_WINDOW_MS: zod_1.z.string().optional(),
        RATE_LIMIT_MAX: zod_1.z.string().optional(),
        JWT_SECRET: zod_1.z.string().optional(),
    }).passthrough();
    const env = EnvSchema.parse(process.env);
    const cfg = {
        port: Number(env.PORT || 8844),
        baseUrl: env.BASE_URL || `http://localhost:${env.PORT || 8844}`,
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
        if (!cfg.mongoUri)
            throw new Error('MONGO_URI is required in production');
        if (!cfg.adminToken)
            throw new Error('ADMIN_TOKEN is required in production');
        if (!env.JWT_SECRET)
            throw new Error('JWT_SECRET is required in production');
    }
    return cfg;
}
