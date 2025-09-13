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
const supertest_1 = __importDefault(require("supertest"));
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const helmet_1 = __importDefault(require("helmet"));
const wallet_routes_1 = require("../services/wallet.routes");
const auth = __importStar(require("../auth"));
const db_1 = require("../db");
function makeApp() {
    const app = (0, express_1.default)();
    app.use((0, helmet_1.default)());
    app.use((0, cors_1.default)());
    app.use(express_1.default.json());
    app.use('/api/wallet', wallet_routes_1.walletRouter);
    return app;
}
describe('Wallet ledger route', () => {
    beforeEach(() => {
        jest.resetAllMocks();
        jest.spyOn(auth, 'validateUserToken').mockResolvedValue(true);
    });
    test('returns empty array when DB disconnected', async () => {
        jest.spyOn(auth, 'isDbConnected').mockReturnValue(false);
        const app = makeApp();
        const res = await (0, supertest_1.default)(app)
            .get('/api/wallet/ledger')
            .query({ limit: 10, skip: 0 })
            .set('x-user-id', 'u1')
            .set('x-user-token', 't');
        expect(res.status).toBe(200);
        expect(Array.isArray(res.body.data)).toBe(true);
    });
    test('returns rows when DB connected', async () => {
        jest.spyOn(auth, 'isDbConnected').mockReturnValue(true);
        const rows = [
            { userId: 'u1', delta: 10, reason: 'round_settlement', ref: 'g1', balanceAfter: '10.00', createdAt: new Date() },
        ];
        const findSpy = jest.spyOn(db_1.WalletLedgerModel, 'find').mockReturnValue({
            sort: () => ({
                skip: () => ({
                    limit: () => ({
                        lean: () => ({
                            exec: async () => rows,
                        }),
                    }),
                }),
            }),
        });
        const app = makeApp();
        const res = await (0, supertest_1.default)(app)
            .get('/api/wallet/ledger')
            .query({ limit: 10, skip: 0 })
            .set('x-user-id', 'u1')
            .set('x-user-token', 't');
        expect(res.status).toBe(200);
        expect(res.body.data.length).toBe(1);
        expect(res.body.data[0].reason).toBe('round_settlement');
        expect(findSpy).toHaveBeenCalledWith({ userId: 'u1' });
    });
});
