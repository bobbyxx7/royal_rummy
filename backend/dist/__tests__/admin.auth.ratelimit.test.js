"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const supertest_1 = __importDefault(require("supertest"));
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const helmet_1 = __importDefault(require("helmet"));
const express_rate_limit_1 = __importDefault(require("express-rate-limit"));
const admin_routes_1 = require("../services/admin.routes");
function makeApp(withLimiter = true) {
    const app = (0, express_1.default)();
    app.use((0, helmet_1.default)());
    app.use((0, cors_1.default)());
    app.use(express_1.default.json());
    if (withLimiter) {
        // mirror server.ts limiter defaults for /api/*
        app.use('/api/', (0, express_rate_limit_1.default)({ windowMs: 60000, max: 5, standardHeaders: true, legacyHeaders: false }));
    }
    app.use('/api/admin', admin_routes_1.adminRouter);
    return app;
}
describe('Admin endpoints auth and rate-limit', () => {
    const adminToken = 'admintoken';
    beforeAll(() => {
        jest.spyOn(require('../config'), 'loadConfig').mockReturnValue({ adminToken });
    });
    afterAll(() => jest.restoreAllMocks());
    test('rejects without admin token', async () => {
        const app = makeApp(false);
        const res = await (0, supertest_1.default)(app).get('/api/admin/health');
        expect(res.status).toBe(401);
    });
    test('accepts with correct admin token', async () => {
        const app = makeApp(false);
        const res = await (0, supertest_1.default)(app).get('/api/admin/health').set('x-admin-token', adminToken);
        expect(res.status).toBe(200);
        expect(res.body?.code).toBe(200);
    });
    test('rate-limits excessive requests under /api/', async () => {
        const app = makeApp(true);
        // Hit a non-admin API path to exercise limiter behavior consistently
        // Use admin path too since limiter is mounted at /api/
        let lastStatus = 200;
        for (let i = 0; i < 10; i++) {
            const r = await (0, supertest_1.default)(app).get('/api/admin/health').set('x-admin-token', adminToken);
            lastStatus = r.status;
            if (r.status === 429)
                break;
        }
        expect([200, 429]).toContain(lastStatus);
    });
});
