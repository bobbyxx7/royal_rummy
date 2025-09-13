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
const rules = __importStar(require("../socket/rules"));
const rummy_namespace_1 = require("../socket/rummy.namespace");
const db_1 = require("../db");
jest.setTimeout(20000);
describe('declare valid path scoring and deltas', () => {
    let httpServer;
    let ioServer;
    let addr;
    beforeAll((done) => {
        process.env.TURN_MS = '6000';
        process.env.POINT_VALUE = '1';
        process.env.MAX_POINTS = '80';
        process.env.RAKE_PERCENT = '0';
        process.env.AUTO_FILL_BOT = '0';
        process.env.TOSS_JOIN_ORDER = '1';
        process.env.TEST_LOOSE_DECLARE = '1';
        process.env.TEST_WILD_RANK = '5';
        process.env.TEST_HAND_S0 = 'RP2,RP3,RP4,BP6,BP7,BP8,BL9,BL10,BLJ,RSQ,RSQ,BLQ,BPQ';
        process.env.TEST_HAND_S1 = 'RPA,BPA,BLA,RSA,RP2,RP5,BP9,BL2,RS3,BP4,BL5,RS6,JKR1';
        httpServer = http_1.default.createServer();
        ioServer = new socket_io_1.Server(httpServer, { path: '/socket.io' });
        (0, rummy_namespace_1.rummyNamespace)(ioServer);
        httpServer.listen(() => {
            addr = httpServer.address();
            done();
        });
    });
    afterAll((done) => {
        ioServer.close(() => httpServer.close(() => done()));
    });
    test.skip('winner gets deltas and losers are debited', (done) => {
        jest.setTimeout(20000);
        jest.spyOn(auth, 'isDbConnected').mockReturnValue(true);
        jest.spyOn(auth, 'validateUserToken').mockResolvedValue(true);
        jest.spyOn(rules, 'validateDeclare').mockReturnValue({ valid: true, pureSeq: 1, totalSeq: 2 });
        const rrSpy = jest.spyOn(db_1.RoundResultModel, 'create').mockResolvedValue({});
        const wlSpy = jest.spyOn(db_1.WalletLedgerModel, 'create').mockResolvedValue({});
        jest.spyOn(db_1.UserModel, 'updateOne').mockReturnValue({ exec: async () => ({}) });
        jest.spyOn(db_1.UserModel, 'findById').mockImplementation((id) => ({ select: () => ({ lean: () => ({ exec: async () => ({ wallet: '100.00' }) }) }) }));
        const url = `http://localhost:${addr.port}/rummy`;
        const c1 = (0, socket_io_client_1.io)(url, { transports: ['websocket'], query: { userId: 'u1', token: 't1' } });
        const c2 = (0, socket_io_client_1.io)(url, { transports: ['websocket'], query: { userId: 'u2', token: 't2' } });
        let hand = [];
        let gameId;
        let mySeat;
        let drawnCard;
        c1.on('my-card', (data) => {
            if (Array.isArray(data?.hand))
                hand = data.hand;
        });
        c1.on('get-card', (data) => {
            if (Array.isArray(data?.hand))
                hand = data.hand;
            if (data?.card)
                drawnCard = data.card;
            // After draw, build groups from the full updated hand (minus finish card) to satisfy strict server coverage
            const finishCard = hand?.[0];
            const remaining = Array.isArray(hand) ? hand.filter((c) => c !== finishCard) : [];
            setTimeout(() => {
                c1.emit('declare', { groups: [remaining], finish_card: finishCard });
            }, 200);
        });
        c1.on('status', (s) => {
            if (!gameId && s?.game_id)
                gameId = s.game_id;
            if (Array.isArray(s?.seats))
                mySeat = s.seats.findIndex((u) => u === 'u1');
            // Once it's our turn, draw; declaration will be triggered in get-card handler after hand updates
            if (s?.phase === 'started' && mySeat != null && mySeat >= 0 && s?.currentTurn === mySeat) {
                c1.emit('get-card', {});
            }
        });
        c1.on('round-end', async (summary) => {
            try {
                expect(summary?.game_id).toBeDefined();
                expect(summary?.winner_user_id).toBe('u1');
                // RoundResultModel.create should be called with deltas
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
        c1.on('connect', () => {
            c1.emit('get-table', { user_id: 'u1', token: 't1', boot_value: '0', no_of_players: 2 });
        });
        c2.on('connect', () => { c2.emit('get-table', { user_id: 'u2', token: 't2', boot_value: '0', no_of_players: 2 }); });
        c1.on('get-table', (data) => c1.emit('join-table', { user_id: 'u1', token: 't1', table_id: data.table_id }));
        c2.on('get-table', (data) => c2.emit('join-table', { user_id: 'u2', token: 't2', table_id: data.table_id }));
    });
});
