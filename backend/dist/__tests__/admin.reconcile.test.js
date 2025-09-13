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
const admin_routes_1 = require("../services/admin.routes");
const auth = __importStar(require("../auth"));
const db = __importStar(require("../db"));
function makeApp() {
    const app = (0, express_1.default)();
    app.use((0, helmet_1.default)());
    app.use((0, cors_1.default)());
    app.use(express_1.default.json());
    app.use('/api/admin', admin_routes_1.adminRouter);
    return app;
}
describe('Admin reconcile endpoint', () => {
    const adminToken = 'admintoken';
    beforeAll(() => {
        jest.spyOn(require('../config'), 'loadConfig').mockReturnValue({ adminToken });
        jest.spyOn(auth, 'isDbConnected').mockReturnValue(true);
    });
    afterAll(() => jest.restoreAllMocks());
    test('returns inconsistencies and sample', async () => {
        // Mock DB models minimal behavior
        db.UserModel = {
            find: () => ({ select: () => ({ limit: () => ({ lean: () => ({ exec: async () => ([{ _id: 'u1', wallet: '50.00' }, { _id: 'u2', wallet: '0.00' }]) }) }) }) })
        };
        db.WalletLedgerModel = {
            aggregate: () => ({ exec: async () => ([{ _id: 'u1', totalDelta: 60 }, { _id: 'u2', totalDelta: 0 }]) })
        };
        db.WalletHoldModel = {
            aggregate: () => ({ exec: async () => ([{ _id: 'u1', totalHold: 10 }]) })
        };
        const app = makeApp();
        const res = await (0, supertest_1.default)(app).get('/api/admin/reconcile').set('x-admin-token', adminToken);
        expect(res.status).toBe(200);
        expect(res.body?.data?.count).toBeGreaterThan(0);
        expect(Array.isArray(res.body?.data?.inconsistencies)).toBe(true);
    });
});
