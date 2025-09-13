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
function makeApp() {
    const app = (0, express_1.default)();
    app.use((0, helmet_1.default)());
    app.use((0, cors_1.default)());
    app.use(express_1.default.json());
    app.use('/api/admin', admin_routes_1.adminRouter);
    return app;
}
describe('Admin health endpoint', () => {
    const adminToken = 'admintoken';
    beforeAll(() => {
        jest.spyOn(require('../config'), 'loadConfig').mockReturnValue({ adminToken });
    });
    afterAll(() => jest.restoreAllMocks());
    test('GET /health returns basic stats', async () => {
        const app = makeApp();
        const res = await (0, supertest_1.default)(app).get('/api/admin/health').set('x-admin-token', adminToken);
        expect(res.status).toBe(200);
        expect(res.body?.data).toHaveProperty('db');
        expect(res.body?.data).toHaveProperty('tables');
        expect(res.body?.data).toHaveProperty('games');
        expect(res.body?.data).toHaveProperty('upMs');
    });
});
