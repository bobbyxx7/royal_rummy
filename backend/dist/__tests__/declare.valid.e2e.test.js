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
jest.setTimeout(25000);
describe('valid declare end-to-end (deterministic)', () => {
    let httpServer;
    let ioServer;
    let addr;
    beforeAll((done) => {
        // Deterministic + fast (disable timers)
        process.env.TURN_MS = '4000';
        process.env.TEST_DISABLE_TIMERS = '1';
        process.env.POINT_VALUE = '1';
        process.env.MAX_POINTS = '80';
        process.env.RAKE_PERCENT = '0';
        process.env.AUTO_FILL_BOT = '0';
        process.env.TOSS_JOIN_ORDER = '1';
        process.env.TEST_LOOSE_DECLARE = '1';
        process.env.TEST_WILD_RANK = '5';
        // u1 hand: 3 sequences + a set (13)
        process.env.TEST_HAND_S0 = 'RP2,RP3,RP4,BP6,BP7,BP8,BL9,BL10,BLJ,RSQ,BLQ,BPQ,RPQ';
        // Give u2 any 13 (not needed explicitly; will be dealt)
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
    test.skip('u1 declares valid, emits round-end and applies settlements', (done) => {
        jest.spyOn(auth, 'isDbConnected').mockReturnValue(true);
        jest.spyOn(auth, 'validateUserToken').mockResolvedValue(true);
        const rrSpy = jest.spyOn(db_1.RoundResultModel, 'create').mockResolvedValue({});
        const wlSpy = jest.spyOn(db_1.WalletLedgerModel, 'create').mockResolvedValue({});
        jest.spyOn(db_1.UserModel, 'updateOne').mockReturnValue({ exec: async () => ({}) });
        jest.spyOn(db_1.UserModel, 'findById').mockImplementation((_id) => ({ select: () => ({ lean: () => ({ exec: async () => ({ wallet: '100.00' }) }) }) }));
        // stub holds APIs
        jest.spyOn(db_1.WalletHoldModel, 'findOne').mockReturnValue({ lean: () => ({ exec: async () => null }) });
        jest.spyOn(db_1.WalletHoldModel, 'create').mockResolvedValue({});
        jest.spyOn(db_1.WalletHoldModel, 'find').mockReturnValue({ lean: () => ({ exec: async () => [] }) });
        jest.spyOn(db_1.WalletHoldModel, 'updateMany').mockReturnValue({ exec: async () => ({}) });
        const url = `http://localhost:${addr.port}/rummy`;
        const c1 = (0, socket_io_client_1.io)(url, { transports: ['websocket'], query: { userId: 'u1', token: 't1' } });
        // Sequence: join u1 first, then u2 to ensure u1 gets seat 0 and first turn
        let tableId;
        c1.on('connect', () => {
            c1.emit('get-table', { user_id: 'u1', token: 't1', boot_value: '0', no_of_players: 2 });
        });
        c1.on('get-table', (data) => {
            tableId = data?.table_id;
            c1.emit('join-table', { user_id: 'u1', token: 't1', table_id: tableId });
        });
        const c2 = (0, socket_io_client_1.io)(url, { transports: ['websocket'], query: { userId: 'u2', token: 't2' } });
        // Join u2 only after u1 joined
        c1.on('join-table', () => {
            if (tableId)
                c2.emit('join-table', { user_id: 'u2', token: 't2', table_id: tableId });
        });
        let mySeat;
        c1.on('status', (s) => {
            if (Array.isArray(s?.seats))
                mySeat = s.seats.findIndex((u) => u === 'u1');
            if (s?.phase === 'started' && mySeat === s?.currentTurn) {
                setTimeout(() => c1.emit('test_force_declare', {}), 50);
            }
        });
        // No further actions needed; test_force_declare will complete the round
        c1.on('round-end', (summary) => {
            try {
                expect(summary?.winner_user_id).toBe('u1');
                expect(rrSpy).toHaveBeenCalled();
                expect(wlSpy).toHaveBeenCalled();
                c1.close();
                c2.close();
                done();
            }
            catch (e) {
                c1.close();
                c2.close();
                done(e);
            }
        });
    });
});
