"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const supertest_1 = __importDefault(require("supertest"));
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const helmet_1 = __importDefault(require("helmet"));
const admin_routes_1 = require("../services/admin.routes");
const format_state_1 = require("../socket/format.state");
function makeApp() {
    const app = (0, express_1.default)();
    app.use((0, helmet_1.default)());
    app.use((0, cors_1.default)());
    app.use(express_1.default.json());
    app.use('/api/admin', admin_routes_1.adminRouter);
    return app;
}
describe('Admin format-state endpoint', () => {
    const adminToken = 'admintoken';
    beforeAll(() => {
        jest.spyOn(require('../config'), 'loadConfig').mockReturnValue({ adminToken });
    });
    afterEach(() => {
        format_state_1.poolStateByTable.clear();
        format_state_1.dealsStateByTable.clear();
    });
    afterAll(() => jest.restoreAllMocks());
    test('returns current pool and deals states', async () => {
        format_state_1.poolStateByTable.set('tbl-pool', { cumulative: { a: 10, b: 30 }, eliminated: new Set(['b']), threshold: 101 });
        format_state_1.dealsStateByTable.set('tbl-deals', { remaining: 1, cumulative: { x: 20, y: 0 } });
        const app = makeApp();
        const res = await (0, supertest_1.default)(app).get('/api/admin/format-state').set('x-admin-token', adminToken);
        expect(res.status).toBe(200);
        expect(Array.isArray(res.body?.data?.pool)).toBe(true);
        expect(Array.isArray(res.body?.data?.deals)).toBe(true);
        const pool = res.body.data.pool.find((p) => p.tableId === 'tbl-pool');
        const deals = res.body.data.deals.find((d) => d.tableId === 'tbl-deals');
        expect(pool.cumulative.a).toBe(10);
        expect(pool.eliminated).toContain('b');
        expect(pool.threshold).toBe(101);
        expect(deals.remaining).toBe(1);
        expect(deals.cumulative.x).toBe(20);
    });
});
