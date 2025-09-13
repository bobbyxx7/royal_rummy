"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const supertest_1 = __importDefault(require("supertest"));
const express_1 = __importDefault(require("express"));
const metrics_routes_1 = require("../services/metrics.routes");
describe('Metrics endpoint', () => {
    test('returns text/plain metrics', async () => {
        const app = (0, express_1.default)();
        app.use('/api', metrics_routes_1.metricsRouter);
        const res = await (0, supertest_1.default)(app).get('/api/metrics');
        expect(res.status).toBe(200);
        expect(res.type).toMatch(/text\/plain/);
        expect(res.text).toMatch(/rummy_active_games/);
    });
});
