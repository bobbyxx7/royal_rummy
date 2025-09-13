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
const db_1 = require("../db");
function makeApp() {
    const app = (0, express_1.default)();
    app.use((0, helmet_1.default)());
    app.use((0, cors_1.default)());
    app.use(express_1.default.json());
    app.use('/api/admin', admin_routes_1.adminRouter);
    return app;
}
describe('Admin rake endpoint', () => {
    const adminToken = 'admintoken';
    beforeAll(() => {
        jest.spyOn(require('../config'), 'loadConfig').mockReturnValue({ adminToken });
    });
    afterAll(() => jest.restoreAllMocks());
    test('aggregates rake over time range', async () => {
        db_1.RoundResultModel.aggregate = jest.fn().mockReturnValue({ exec: async () => ([{ totalRake: 12.5, rounds: 5 }]) });
        const app = makeApp();
        const res = await (0, supertest_1.default)(app).get('/api/admin/rake?from=2020-01-01&to=2030-01-01').set('x-admin-token', adminToken);
        expect(res.status).toBe(200);
        expect(res.body?.data?.rounds).toBeDefined();
    });
});
