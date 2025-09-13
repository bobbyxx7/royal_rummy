"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const http_1 = __importDefault(require("http"));
const socket_io_1 = require("socket.io");
const socket_io_client_1 = require("socket.io-client");
const rummy_namespace_1 = require("../socket/rummy.namespace");
describe('turn timer behavior', () => {
    let httpServer;
    let ioServer;
    let addr;
    beforeAll((done) => {
        // Configure tiny turn time and remove reserve requirement
        process.env.TURN_MS = '100';
        process.env.MAX_POINTS = '0';
        process.env.AUTO_FILL_BOT = '1';
        httpServer = http_1.default.createServer();
        ioServer = new socket_io_1.Server(httpServer, { path: '/socket.io' });
        (0, rummy_namespace_1.rummyNamespace)(ioServer);
        httpServer.listen(() => {
            addr = httpServer.address();
            done();
        });
    });
    afterAll((done) => {
        ioServer.of('/rummy').disconnectSockets(true);
        ioServer.close(() => {
            httpServer.close(() => done());
        });
    });
    test('emits status with turnDeadline within a few seconds', (done) => {
        const url = `http://localhost:${addr.port}/rummy`;
        const client = (0, socket_io_client_1.io)(url, { transports: ['websocket'], query: { userId: 'u1', token: 't' } });
        const statuses = [];
        client.on('status', (payload) => {
            statuses.push(payload);
        });
        client.on('connect', () => {
            client.emit('get-table', { user_id: 'u1', token: 't', boot_value: '0', no_of_players: 2 });
        });
        client.on('get-table', (data) => {
            client.emit('join-table', { user_id: 'u1', token: 't', table_id: data.table_id });
        });
        // Wait: 3s for toss + small buffer + 100ms for turn timeout
        setTimeout(() => {
            try {
                const last = statuses[statuses.length - 1];
                expect(last).toBeDefined();
                expect(last?.turnDeadline ?? null).not.toBeUndefined();
                client.close();
                done();
            }
            catch (e) {
                client.close();
                done(e);
            }
        }, 3300);
    });
});
