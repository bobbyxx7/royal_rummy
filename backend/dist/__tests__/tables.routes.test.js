"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const supertest_1 = __importDefault(require("supertest"));
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const helmet_1 = __importDefault(require("helmet"));
const tables_routes_1 = require("../services/tables.routes");
const state_1 = require("../socket/state");
function makeApp() {
    const app = (0, express_1.default)();
    app.use((0, helmet_1.default)());
    app.use((0, cors_1.default)());
    app.use(express_1.default.json());
    app.use('/api', tables_routes_1.tablesRouter);
    return app;
}
describe('GET /api/tables/available', () => {
    test('returns available tables with filters and pagination', async () => {
        state_1.waitingTables.clear();
        const t1 = (0, state_1.createOrFindTable)('80', 2);
        const t2 = (0, state_1.createOrFindTable)('800', 6);
        const app = makeApp();
        const res = await (0, supertest_1.default)(app).get('/api/tables/available').query({ boot_value: '80', no_of_players: 2 });
        expect(res.status).toBe(200);
        expect(res.body?.data?.length).toBeGreaterThanOrEqual(1);
        expect(res.body.data[0]).toHaveProperty('table_id');
        expect(res.body.data[0]).toHaveProperty('joined');
    });
});
