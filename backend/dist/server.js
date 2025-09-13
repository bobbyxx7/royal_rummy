"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
const express_1 = __importDefault(require("express"));
const http_1 = __importDefault(require("http"));
const cors_1 = __importDefault(require("cors"));
const helmet_1 = __importDefault(require("helmet"));
const morgan_1 = __importDefault(require("morgan"));
const express_rate_limit_1 = __importDefault(require("express-rate-limit"));
const socket_io_1 = require("socket.io");
const auth_routes_1 = require("./services/auth.routes");
const user_routes_1 = require("./services/user.routes");
const db_1 = require("./db");
const rummy_namespace_1 = require("./socket/rummy.namespace");
const teenpatti_namespace_1 = require("./socket/teenpatti.namespace");
const emitter_1 = require("./socket/emitter");
const admin_routes_1 = require("./services/admin.routes");
const tables_routes_1 = require("./services/tables.routes");
const wallet_routes_1 = require("./services/wallet.routes");
const config_1 = require("./config");
const requestId_1 = require("./middleware/requestId");
const metrics_routes_1 = require("./services/metrics.routes");
const profile_1 = require("./middleware/profile");
const test_routes_1 = require("./services/test.routes");
const cors_2 = require("./services/cors");
const app = (0, express_1.default)();
const server = http_1.default.createServer(app);
const cfg = (0, config_1.loadConfig)();
const PORT = cfg.port;
const CLIENT_ORIGIN = cfg.clientOrigin;
// Middleware
app.use((0, helmet_1.default)());
app.use((0, cors_1.default)((0, cors_2.getCorsOptions)()));
app.use(requestId_1.requestId);
app.use(profile_1.profileHttp);
app.use(express_1.default.urlencoded({ extended: true }));
app.use(express_1.default.json());
app.use((0, morgan_1.default)('dev'));
// Basic rate limiting for public APIs
const limiter = (0, express_rate_limit_1.default)({ windowMs: cfg.rateLimitWindowMs, max: cfg.rateLimitMax, standardHeaders: true, legacyHeaders: false });
app.use('/api/', limiter);
// Health
app.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
});
// Readiness (checks DB when configured)
app.get('/ready', async (_req, res) => {
    try {
        if (cfg.mongoUri) {
            await (0, db_1.connectMongo)(cfg.mongoUri);
        }
        return res.json({ status: 'ready' });
    }
    catch (e) {
        return res.status(500).json({ status: 'not-ready' });
    }
});
// API base matching mobile app constants
// ApiConstants.apiUrl is https://syspsy.live/ and endpoints begin with /api/ and /Rummy/ and /rummy/
// We'll locally expose the same paths so the app can point to our backend by changing apiUrl.
app.use('/api/user', auth_routes_1.authRouter);
app.use('/api/user', user_routes_1.userRouter);
app.use('/api/admin', admin_routes_1.adminRouter);
app.use('/api', tables_routes_1.tablesRouter);
app.use('/api/wallet', wallet_routes_1.walletRouter);
app.use('/api', metrics_routes_1.metricsRouter);
app.use('/api/test', test_routes_1.testRouter);
const io = new socket_io_1.Server(server, { cors: (0, cors_2.getCorsOptions)(), path: '/socket.io' });
// Socket namespaces expected by app: '/rummy' and '/teenpatti'
(0, emitter_1.registerIo)(io);
(0, rummy_namespace_1.rummyNamespace)(io);
(0, teenpatti_namespace_1.teenPattiNamespace)(io);
async function start() {
    const mongoUri = cfg.mongoUri || '';
    if (mongoUri) {
        try {
            await (0, db_1.connectMongo)(mongoUri);
            // eslint-disable-next-line no-console
            console.log('[db] connected');
            try {
                await (0, rummy_namespace_1.restoreSnapshots)();
                console.log('[restore] snapshots restored');
            }
            catch { }
            // Warn if rake configured but rake wallet not set
            const rakePct = Number(process.env.RAKE_PERCENT || 0);
            if (rakePct > 0 && !process.env.RAKE_WALLET_USER_ID) {
                // eslint-disable-next-line no-console
                console.warn('[config] RAKE_PERCENT > 0 but RAKE_WALLET_USER_ID is not set. Rake will not be credited.');
            }
        }
        catch (e) {
            // eslint-disable-next-line no-console
            console.error('[db] connection failed', e);
        }
    }
    server.listen(PORT, '0.0.0.0', () => {
        // eslint-disable-next-line no-console
        console.log(`Backend listening on ${cfg.baseUrl}`);
    });
}
start();
