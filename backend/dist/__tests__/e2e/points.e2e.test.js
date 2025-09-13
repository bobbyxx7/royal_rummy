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
const db_1 = require("../../db");
jest.setTimeout(40000);
describe('E2E/Points Rummy - deterministic round end', () => {
    let httpServer;
    let app;
    let ioServer;
    let addr;
    const url = () => `http://localhost:${addr.port}/rummy`;
    beforeAll((done) => {
        // Deterministic + fast
        process.env.TURN_MS = '4000';
        process.env.POINT_VALUE = '0';
        process.env.MAX_POINTS = '0';
        process.env.RAKE_PERCENT = '0';
        process.env.AUTO_FILL_BOT = '0';
        process.env.TOSS_JOIN_ORDER = '1';
        process.env.TEST_DISABLE_TIMERS = '1';
        jest.spyOn(auth, 'validateUserToken').mockResolvedValue(true);
        jest.spyOn(auth, 'isDbConnected').mockReturnValue(false);
        process.env.ADMIN_TOKEN = 'test-admin';
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
    test('round ends deterministically via test_force_declare', async () => {
        let forceDeclared = false;
        jest.spyOn(db_1.RoundResultModel, 'create').mockImplementation(async () => { forceDeclared = true; return {}; });
        jest.spyOn(db_1.RoundResultModel, 'find').mockReturnValue({
            sort: () => ({
                limit: () => ({
                    lean: () => ({ exec: async () => (forceDeclared ? [{ winnerUserId: 'p1', points: [{ user_id: 'p1', delta: 1 }, { user_id: 'p2', delta: -1 }] }] : []) })
                })
            })
        });
        jest.spyOn(db_1.WalletLedgerModel, 'create').mockResolvedValue({});
        jest.spyOn(db_1.UserModel, 'updateOne').mockReturnValue({ exec: async () => ({}) });
        jest.spyOn(db_1.UserModel, 'findById').mockImplementation((_id) => ({ select: () => ({ lean: () => ({ exec: async () => ({ wallet: '100.00' }) }) }) }));
        // No DB ops in join flow when isDbConnected=false; leaving holds mocks unused
        const c1 = (0, e2e_1.connectClient)(url(), 'p1', 't1');
        const c2 = (0, e2e_1.connectClient)(url(), 'p2', 't2');
        await new Promise((resolve, reject) => {
            const timeout = setTimeout(() => { try {
                c1.close();
                c2.close();
            }
            catch { } ; reject(new Error('E2E points timed out')); }, 30000);
            let gameId;
            let started = false;
            let tableId;
            const maybe = async () => {
                if (started && gameId && tableId) {
                    // bind session/seat once before declare
                    try {
                        c1.emit('status', { user_id: 'p1', token: 't1', game_id: gameId });
                    }
                    catch { }
                    // drive end via admin endpoint
                    setTimeout(async () => {
                        try {
                            await (0, supertest_1.default)(app).post('/api/test/points/force-declare').set('x-admin-token', 'test-admin').send({ tableId, userId: 'p1' });
                        }
                        catch { }
                    }, 50);
                    // also try admin search loop to confirm completion
                    for (let i = 0; i < 80; i++) {
                        try {
                            // If we have observed RoundResultModel.create, short-circuit
                            if (forceDeclared) {
                                clearTimeout(timeout);
                                try {
                                    c1.close();
                                    c2.close();
                                }
                                catch { }
                                return resolve();
                            }
                            const res = await (0, supertest_1.default)(app)
                                .get(`/api/admin/rounds/search?tableId=${tableId}&limit=1`)
                                .set('x-admin-token', 'test-admin');
                            if ((res.body?.data || []).length > 0) {
                                clearTimeout(timeout);
                                try {
                                    c1.close();
                                    c2.close();
                                }
                                catch { }
                                return resolve();
                            }
                        }
                        catch { }
                        await new Promise(r => setTimeout(r, 100));
                    }
                }
            };
            c1.on('start-game', (sg) => {
                if (!gameId && sg?.game_id)
                    gameId = sg.game_id;
                maybe();
            });
            c1.on('status', (s) => {
                if (!gameId && s?.game_id)
                    gameId = s.game_id;
                if (!tableId && s?.table_id)
                    tableId = s.table_id;
                if (s?.phase === 'started') {
                    started = true;
                }
                maybe();
            });
            c1.on('round-end', () => {
                clearTimeout(timeout);
                try {
                    c1.close();
                    c2.close();
                }
                catch { }
                resolve();
            });
            // Poll admin rounds to avoid reliance on broadcast timing
            (async () => {
                for (let i = 0; i < 80; i++) {
                    try {
                        if (!tableId) {
                            await new Promise(r => setTimeout(r, 100));
                            continue;
                        }
                        if (forceDeclared) {
                            clearTimeout(timeout);
                            try {
                                c1.close();
                                c2.close();
                            }
                            catch { }
                            return resolve();
                        }
                        const res = await (0, supertest_1.default)(app)
                            .get(`/api/admin/rounds/search?tableId=${tableId}&limit=1`)
                            .set('x-admin-token', 'test-admin');
                        if ((res.body?.data || []).length > 0) {
                            clearTimeout(timeout);
                            try {
                                c1.close();
                                c2.close();
                            }
                            catch { }
                            return resolve();
                        }
                    }
                    catch { }
                    await new Promise(r => setTimeout(r, 100));
                }
            })();
            // Fallback driver: if we didn't see started, try to detect game via admin and force declare
            (async () => {
                for (let i = 0; i < 80; i++) {
                    try {
                        if (forceDeclared)
                            return;
                        if (!tableId) {
                            const g = await (0, supertest_1.default)(app).get('/api/admin/games').set('x-admin-token', 'test-admin');
                            const first = (g.body?.data || [])[0];
                            if (first?.tableId)
                                tableId = first.tableId;
                        }
                        if (tableId && !forceDeclared) {
                            await (0, supertest_1.default)(app).post('/api/test/points/force-declare').set('x-admin-token', 'test-admin').send({ tableId, userId: 'p1' });
                            return;
                        }
                    }
                    catch { }
                    await new Promise(r => setTimeout(r, 100));
                }
            })();
            c1.on('connect', () => {
                c1.emit('get-table', { user_id: 'p1', token: 't1', boot_value: '0', no_of_players: 2, format: 'points' });
            });
            c2.on('connect', () => {
                c2.emit('get-table', { user_id: 'p2', token: 't2', boot_value: '0', no_of_players: 2, format: 'points' });
            });
            c1.on('get-table', (data) => c1.emit('join-table', { user_id: 'p1', token: 't1', table_id: data.table_id, idempotencyKey: 'idemA' }));
            c2.on('get-table', (data) => c2.emit('join-table', { user_id: 'p2', token: 't2', table_id: data.table_id, idempotencyKey: 'idemB' }));
        });
    });
});
