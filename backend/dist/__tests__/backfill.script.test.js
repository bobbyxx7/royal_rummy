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
jest.mock('../config', () => ({ loadConfig: () => ({ mongoUri: 'mongodb://mock' }) }));
jest.mock('../db', () => ({ connectMongo: jest.fn(), UserModel: { updateOne: jest.fn().mockReturnValue({ exec: async () => ({}) }) }, WalletLedgerModel: { create: jest.fn() } }));
jest.mock('../services/reconcile', () => ({ reconcileWallets: jest.fn().mockResolvedValue({ inconsistencies: [{ userId: 'u1', wallet: 10, expected: 12, diff: -2 }] }) }));
describe('backfill script', () => {
    test('dry-run outputs repairs without applying', async () => {
        const consoleLogSpy = jest.spyOn(console, 'log').mockImplementation(() => { });
        const mod = await Promise.resolve().then(() => __importStar(require('../scripts/backfill_wallets')));
        process.env.BACKFILL_LIMIT = '10';
        process.env.BACKFILL_THRESHOLD = '0.5';
        // @ts-ignore
        await mod.runBackfill();
        expect(consoleLogSpy).toHaveBeenCalled();
        consoleLogSpy.mockRestore();
    });
});
