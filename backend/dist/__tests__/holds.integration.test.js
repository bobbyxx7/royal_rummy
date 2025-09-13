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
const db_1 = require("../db");
jest.setTimeout(15000);
describe('wallet hold on join-table', () => {
    let httpServer;
    let ioServer;
    let addr;
    beforeAll((done) => {
        process.env.MAX_POINTS = '10';
        process.env.POINT_VALUE = '1';
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
        ioServer.close(() => httpServer.close(() => done()));
    });
    test('places hold, ledger entry, and wallet decrement when DB connected', (done) => {
        jest.spyOn(auth, 'isDbConnected').mockReturnValue(true);
        jest.spyOn(auth, 'validateUserToken').mockResolvedValue(true);
        const findById = jest.spyOn(db_1.UserModel, 'findById').mockImplementation((id) => {
            return {
                select: () => ({ lean: () => ({ exec: async () => ({ wallet: '100.00' }) }) }),
            };
        });
        const findOne = jest.spyOn(db_1.WalletHoldModel, 'findOne').mockReturnValue({ lean: () => ({ exec: async () => null }) });
        const createHold = jest.spyOn(db_1.WalletHoldModel, 'create').mockResolvedValue({});
        const createLedger = jest.spyOn(db_1.WalletLedgerModel, 'create').mockResolvedValue({});
        const updateOne = jest.spyOn(db_1.UserModel, 'updateOne').mockReturnValue({ exec: async () => ({}) });
        const url = `http://localhost:${addr.port}/rummy`;
        const client = (0, socket_io_client_1.io)(url, { transports: ['websocket'], query: { userId: 'u1', token: 't' } });
        client.on('connect', () => {
            client.emit('get-table', { user_id: 'u1', token: 't', boot_value: '0', no_of_players: 2 });
        });
        client.on('get-table', (data) => {
            client.emit('join-table', { user_id: 'u1', token: 't', table_id: data.table_id });
            setTimeout(() => {
                try {
                    expect(createHold).toHaveBeenCalled();
                    expect(createLedger).toHaveBeenCalled();
                    expect(updateOne).toHaveBeenCalled();
                    client.close();
                    done();
                }
                catch (e) {
                    client.close();
                    done(e);
                }
            }, 100);
        });
    });
});
