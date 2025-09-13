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
describe('declare flow constraints', () => {
    let httpServer;
    let ioServer;
    let addr;
    beforeAll((done) => {
        process.env.TURN_MS = '3000';
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
        // Ensure all connections are closed cleanly
        ioServer.of('/rummy').disconnectSockets(true);
        ioServer.close(() => httpServer.close(() => done()));
    });
    test('declare without drawing and not on turn is rejected', (done) => {
        jest.spyOn(auth, 'isDbConnected').mockReturnValue(false);
        const url = `http://localhost:${addr.port}/rummy`;
        const client = (0, socket_io_client_1.io)(url, { transports: ['websocket'], query: { userId: 'u1', token: 't' } });
        let finishCard;
        client.on('my-card', (data) => {
            // pick any card in hand as finish card
            finishCard = data?.hand?.[0];
        });
        client.on('connect', () => {
            client.emit('get-table', { user_id: 'u1', token: 't', boot_value: '0', no_of_players: 2 });
        });
        client.on('get-table', (data) => {
            client.emit('join-table', { user_id: 'u1', token: 't', table_id: data.table_id });
        });
        client.on('declare', (resp) => {
            try {
                expect([400, 401, 404, 409]).toContain(resp?.code);
                client.close();
                done();
            }
            catch (e) {
                client.close();
                done(e);
            }
        });
        // Try declare soon after join (not our turn and no draw yet)
        setTimeout(() => {
            client.emit('declare', { groups: [], finish_card: finishCard });
        }, 1500);
    });
});
