"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const http_1 = __importDefault(require("http"));
const express_1 = __importDefault(require("express"));
const supertest_1 = __importDefault(require("supertest"));
const socket_io_1 = require("socket.io");
const rummy_namespace_1 = require("../../socket/rummy.namespace");
const auth = __importStar(require("../../auth"));
const e2e_1 = require("../helpers/e2e");
const admin_routes_1 = require("../../services/admin.routes");
const test_routes_1 = require("../../services/test.routes");
jest.setTimeout(30000);
describe('E2E/Deals Rummy - deterministic via HTTP advance', () => {
    let httpServer;
    let app;
    let ioServer;
    let addr;
    const url = () => `http://localhost:${addr.port}/rummy`;
    beforeAll((done) => {
        process.env.TEST_DISABLE_TIMERS = '1';
        process.env.AUTO_FILL_BOT = '0';
        process.env.TOSS_JOIN_ORDER = '1';
        process.env.DEALS_COUNT = '2';
        process.env.RAKE_PERCENT = '0';
        process.env.ADMIN_TOKEN = 'test-admin';
        jest.spyOn(auth, 'validateUserToken').mockResolvedValue(true);
        jest.spyOn(auth, 'isDbConnected').mockReturnValue(false);
        app = (0, express_1.default)();
        app.use(express_1.default.json());
        app.use('/api/admin', admin_routes_1.adminRouter);
        app.use('/api/test', test_routes_1.testRouter);
        httpServer = http_1.default.createServer(app);
        ioServer = new socket_io_1.Server(httpServer, { path: '/socket.io' });
        (0, rummy_namespace_1.rummyNamespace)(ioServer);
        httpServer.listen(() => { addr = httpServer.address(); done(); });
    });
    afterAll((done) => {
        ioServer.of('/rummy').disconnectSockets(true);
        ioServer.close(() => httpServer.close(() => done()));
    });
    test('deals progresses to remaining=0', async () => {
        const c1 = (0, e2e_1.connectClient)(url(), 'p1', 't1');
        const c2 = (0, e2e_1.connectClient)(url(), 'p2', 't2');
        await new Promise((resolve, reject) => {
            const timeout = setTimeout(() => { try {
                c1.close();
                c2.close();
            }
            catch { } ; reject(new Error('E2E deals timed out')); }, 25000);
            let tableId;
            let started = false;
            const maybe = async () => {
                if (!started || !tableId)
                    return;
                // Drive deals rounds to completion
                for (let i = 0; i < 10; i++) {
                    const res = await (0, supertest_1.default)(app).post('/api/test/deals/advance')
                        .set('x-admin-token', 'test-admin')
                        .send({ tableId, winnerUserId: 'p1' });
                    const remaining = res.body?.data?.remaining ?? -1;
                    if (remaining === 0)
                        break;
                }
                // Assert format-state shows remaining 0
                for (let i = 0; i < 20; i++) {
                    const fs = await (0, supertest_1.default)(app).get('/api/admin/format-state').set('x-admin-token', 'test-admin');
                    const deals = (fs.body?.data?.deals || []);
                    const row = deals.find((d) => d.tableId === tableId);
                    if (row && row.remaining === 0) {
                        clearTimeout(timeout);
                        try {
                            c1.close();
                            c2.close();
                        }
                        catch { }
                        return resolve();
                    }
                    await new Promise(r => setTimeout(r, 100));
                }
            };
            c1.on('start-game', () => { });
            c1.on('status', (s) => {
                if (!tableId && s?.table_id)
                    tableId = s.table_id;
                if (s?.phase === 'started')
                    started = true;
                maybe();
            });
            c1.on('connect', () => {
                c1.emit('get-table', { user_id: 'p1', token: 't1', boot_value: '0', no_of_players: 2, format: 'deals' });
            });
            c2.on('connect', () => {
                c2.emit('get-table', { user_id: 'p2', token: 't2', boot_value: '0', no_of_players: 2, format: 'deals' });
            });
            c1.on('get-table', (data) => c1.emit('join-table', { user_id: 'p1', token: 't1', table_id: data.table_id, idempotencyKey: 'idemA' }));
            c2.on('get-table', (data) => c2.emit('join-table', { user_id: 'p2', token: 't2', table_id: data.table_id, idempotencyKey: 'idemB' }));
        });
    });
});
