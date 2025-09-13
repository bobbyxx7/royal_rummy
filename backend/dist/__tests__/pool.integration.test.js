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
const socket_io_client_1 = require("socket.io-client");
const auth = __importStar(require("../auth"));
const rummy_namespace_1 = require("../socket/rummy.namespace");
const admin_routes_1 = require("../services/admin.routes");
const test_routes_1 = require("../services/test.routes");
jest.setTimeout(30000);
describe('Pool format progression', () => {
    let httpServer;
    let app;
    let ioServer;
    let addr;
    beforeAll((done) => {
        process.env.TURN_MS = '600';
        process.env.TEST_DISABLE_TIMERS = '1';
        process.env.POINT_VALUE = '1';
        process.env.MAX_POINTS = '80';
        process.env.MIDDLE_DROP = '40';
        process.env.FIRST_DROP = '20';
        process.env.RAKE_PERCENT = '0';
        process.env.AUTO_FILL_BOT = '0';
        process.env.TOSS_JOIN_ORDER = '1';
        process.env.POOL_MAX_POINTS = '20';
        process.env.ADMIN_TOKEN = 'test-admin';
        app = (0, express_1.default)();
        app.use(express_1.default.json());
        app.use('/api/admin', admin_routes_1.adminRouter);
        app.use('/api/test', test_routes_1.testRouter);
        httpServer = http_1.default.createServer(app);
        ioServer = new socket_io_1.Server(httpServer, { path: '/socket.io' });
        (0, rummy_namespace_1.rummyNamespace)(ioServer);
        httpServer.listen(() => {
            addr = httpServer.address();
            done();
        });
    });
    afterAll((done) => {
        ioServer.of('/rummy').disconnectSockets(true);
        ioServer.close(() => httpServer.close(() => done()));
    });
    test.skip('emits pool-progress with eliminated after pack', async () => {
        jest.spyOn(auth, 'isDbConnected').mockReturnValue(false);
        jest.spyOn(auth, 'validateUserToken').mockResolvedValue(true);
        const url = `http://localhost:${addr.port}/rummy`;
        const c1 = (0, socket_io_client_1.io)(url, { transports: ['websocket'], query: { userId: 'p1', token: 't1' } });
        const c2 = (0, socket_io_client_1.io)(url, { transports: ['websocket'], query: { userId: 'p2', token: 't2' } });
        await new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                try {
                    c1.close();
                    c2.close();
                }
                catch { }
                reject(new Error('pool-progress not emitted'));
            }, 6000);
            let sawStartGame = false;
            let sawStatusStarted = false;
            let tableId;
            let interval;
            const maybeTrigger = () => {
                if (!interval && sawStartGame && sawStatusStarted) {
                    interval = setInterval(() => c1.emit('test_pool_progress', {}), 80);
                }
            };
            c1.on('start-game', () => { sawStartGame = true; maybeTrigger(); });
            c1.on('status', (s) => {
                if (!tableId && s?.table_id)
                    tableId = s.table_id;
                if (s?.phase === 'started') {
                    sawStatusStarted = true;
                    maybeTrigger();
                }
            });
            // Poll admin format-state until p2 is eliminated for this table
            const poll = async () => {
                if (!tableId)
                    return false;
                await (0, supertest_1.default)(`http://localhost:${addr.port}`)
                    .post('/api/test/pool/advance')
                    .set('x-admin-token', 'test-admin')
                    .send({ tableId });
                const res = await (0, supertest_1.default)(`http://localhost:${addr.port}`)
                    .get('/api/admin/format-state')
                    .set('x-admin-token', 'test-admin');
                const pool = (res.body?.data?.pool ?? []);
                const row = pool.find((d) => d.tableId === tableId);
                return !!row && Array.isArray(row.eliminated) && row.eliminated.includes('p2');
            };
            (async () => {
                for (let i = 0; i < 80; i++) {
                    try {
                        const done = await poll();
                        if (done) {
                            clearTimeout(timeout);
                            try {
                                if (interval)
                                    clearInterval(interval);
                            }
                            catch { }
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
                clearTimeout(timeout);
                try {
                    if (interval)
                        clearInterval(interval);
                }
                catch { }
                try {
                    c1.close();
                    c2.close();
                }
                catch { }
                reject(new Error('p2 not eliminated in pool format'));
            })();
            c1.on('connect', () => {
                c1.emit('get-table', { user_id: 'p1', token: 't1', boot_value: '0', no_of_players: 2, format: 'pool' });
            });
            c2.on('connect', () => {
                c2.emit('get-table', { user_id: 'p2', token: 't2', boot_value: '0', no_of_players: 2, format: 'pool' });
            });
            c1.on('get-table', (data) => c1.emit('join-table', { user_id: 'p1', token: 't1', table_id: data.table_id }));
            c2.on('get-table', (data) => c2.emit('join-table', { user_id: 'p2', token: 't2', table_id: data.table_id }));
        });
    });
});
