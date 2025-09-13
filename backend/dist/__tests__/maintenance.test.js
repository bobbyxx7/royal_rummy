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
Object.defineProperty(exports, "__esModule", { value: true });
const maintenance_1 = require("../services/maintenance");
const auth = __importStar(require("../auth"));
const state = __importStar(require("../socket/state"));
const db_1 = require("../db");
describe('Maintenance sweepers', () => {
    beforeAll(() => { jest.spyOn(auth, 'isDbConnected').mockReturnValue(true); });
    afterAll(() => jest.restoreAllMocks());
    test('sweepStaleHolds releases holds for missing tables', async () => {
        state.waitingTables = new Map([['t1', {}]]);
        state.games = new Map([]);
        db_1.WalletHoldModel.find = jest.fn().mockReturnValue({ lean: () => ({ exec: async () => ([
                    { _id: 'h1', userId: 'u1', tableId: 'tX', amount: 5, active: true },
                ]) }) });
        db_1.WalletLedgerModel.create = jest.fn().mockResolvedValue({});
        db_1.UserModel.updateOne = jest.fn().mockReturnValue({ exec: async () => ({}) });
        db_1.WalletHoldModel.updateOne = jest.fn().mockReturnValue({ exec: async () => ({}) });
        const released = await (0, maintenance_1.sweepStaleHolds)();
        expect(released).toBe(1);
    });
    test('gcSnapshots removes game snapshots with missing tables', async () => {
        state.waitingTables = new Map([['t1', {}]]);
        db_1.GameModel.find = jest.fn().mockReturnValue({ select: () => ({ lean: () => ({ exec: async () => ([
                        { gameId: 'gA', tableId: 'tX' },
                        { gameId: 'gB', tableId: 't1' },
                    ]) }) }) });
        db_1.GameModel.deleteOne = jest.fn().mockReturnValue({ exec: async () => ({}) });
        const deleted = await (0, maintenance_1.gcSnapshots)();
        expect(deleted).toBe(1);
    });
});
