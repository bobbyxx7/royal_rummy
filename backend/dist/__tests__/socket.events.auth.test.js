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
const socket_io_1 = require("socket.io");
const socket_io_client_1 = require("socket.io-client");
const auth = __importStar(require("../auth"));
const rummy_namespace_1 = require("../socket/rummy.namespace");
jest.setTimeout(20000);
describe('Socket per-event auth (401)', () => {
    let httpServer;
    let ioServer;
    let addr;
    beforeAll((done) => {
        httpServer = http_1.default.createServer();
        ioServer = new socket_io_1.Server(httpServer, { path: '/socket.io' });
        (0, rummy_namespace_1.rummyNamespace)(ioServer);
        httpServer.listen(() => { addr = httpServer.address(); done(); });
    });
    afterAll((done) => {
        ioServer.of('/rummy').disconnectSockets(true);
        ioServer.close(() => httpServer.close(() => done()));
    });
    test('get-table emits 401 when token invalid', async () => {
        jest.spyOn(auth, 'validateUserToken').mockResolvedValue(true);
        const url = `http://localhost:${addr.port}/rummy`;
        const c1 = (0, socket_io_client_1.io)(url, { transports: ['websocket'], query: { userId: 'u1', token: 't1' } });
        await new Promise((resolve, reject) => {
            const timeout = setTimeout(() => { try {
                c1.close();
            }
            catch { } ; reject(new Error('no 401 get-table')); }, 4000);
            c1.on('connect', async () => {
                auth.validateUserToken.mockResolvedValueOnce(false);
                c1.emit('get-table', { user_id: 'u1', token: 'bad', boot_value: '0', no_of_players: 2, format: 'points' });
            });
            c1.on('get-table', (res) => {
                try {
                    expect(res?.code).toBe(401);
                    clearTimeout(timeout);
                    try {
                        c1.close();
                    }
                    catch { }
                    ;
                    resolve();
                }
                catch (e) {
                    clearTimeout(timeout);
                    try {
                        c1.close();
                    }
                    catch { }
                    ;
                    reject(e);
                }
            });
        });
    });
    test('status emits 401 when token invalid and DB connected', async () => {
        jest.spyOn(auth, 'validateUserToken').mockResolvedValue(true);
        const url = `http://localhost:${addr.port}/rummy`;
        const c1 = (0, socket_io_client_1.io)(url, { transports: ['websocket'], query: { userId: 'u2', token: 't2' } });
        await new Promise((resolve, reject) => {
            const timeout = setTimeout(() => { try {
                c1.close();
            }
            catch { } ; reject(new Error('no 401 status')); }, 4000);
            c1.on('connect', async () => {
                // Trigger a table and join first so status has a game_id context
                c1.emit('get-table', { user_id: 'u2', token: 't2', boot_value: '0', no_of_players: 2, format: 'points' });
            });
            let tableId;
            c1.on('get-table', (res) => {
                tableId = res?.table_id;
                if (tableId) {
                    c1.emit('join-table', { user_id: 'u2', token: 't2', table_id: tableId });
                }
            });
            c1.on('join-table', () => {
                // Now make token invalid before asking status
                auth.validateUserToken.mockResolvedValueOnce(false);
                // game_id will be set after start-game; we can call status with a fake id to exercise 401 path
                c1.emit('status', { user_id: 'u2', token: 'bad', game_id: 'non-existent' });
            });
            c1.on('status', (res) => {
                try {
                    if (res?.code === 401) {
                        clearTimeout(timeout);
                        try {
                            c1.close();
                        }
                        catch { }
                        ;
                        resolve();
                    }
                }
                catch (e) {
                    clearTimeout(timeout);
                    try {
                        c1.close();
                    }
                    catch { }
                    ;
                    reject(e);
                }
            });
        });
    });
});
