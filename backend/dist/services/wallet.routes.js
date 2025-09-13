"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.walletRouter = void 0;
const express_1 = require("express");
const zod_1 = require("zod");
const auth_1 = require("../auth");
const db_1 = require("../db");
const auth_routes_1 = require("./auth.routes");
const errors_1 = require("../errors");
const router = (0, express_1.Router)();
exports.walletRouter = router;
function extractAuth(req) {
    const userId = req.header('x-user-id') || req.query.user_id || req.body?.user_id;
    const token = req.header('x-user-token') || req.query.token || req.body?.token;
    return { userId: userId ? String(userId) : undefined, token: token ? String(token) : undefined };
}
// GET /api/wallet/balance
router.get('/balance', async (req, res) => {
    const { userId, token } = extractAuth(req);
    if (!userId)
        return res.status(errors_1.ErrorCodes.INVALID_REQUEST).json({ code: errors_1.ErrorCodes.INVALID_REQUEST, message: 'user_id required' });
    const ok = await (0, auth_1.validateUserToken)(userId, token);
    if (!ok)
        return res.status(errors_1.ErrorCodes.UNAUTHORIZED).json({ code: errors_1.ErrorCodes.UNAUTHORIZED, message: 'Unauthorized' });
    try {
        if ((0, auth_1.isDbConnected)()) {
            const user = await db_1.UserModel.findById(userId).select('wallet').lean().exec();
            return res.json({ code: errors_1.ErrorCodes.SUCCESS, message: 'Success', wallet: user?.wallet ?? '0' });
        }
        const mem = auth_routes_1.usersById.get(String(userId));
        return res.json({ code: errors_1.ErrorCodes.SUCCESS, message: 'Success', wallet: mem?.wallet ?? '0' });
    }
    catch (e) {
        return res.status(errors_1.ErrorCodes.SERVER_ERROR).json({ code: errors_1.ErrorCodes.SERVER_ERROR, message: 'error' });
    }
});
// GET /api/wallet/ledger?limit=50&skip=0
router.get('/ledger', async (req, res) => {
    const { userId, token } = extractAuth(req);
    if (!userId)
        return res.status(errors_1.ErrorCodes.INVALID_REQUEST).json({ code: errors_1.ErrorCodes.INVALID_REQUEST, message: 'user_id required' });
    const ok = await (0, auth_1.validateUserToken)(userId, token);
    if (!ok)
        return res.status(errors_1.ErrorCodes.UNAUTHORIZED).json({ code: errors_1.ErrorCodes.UNAUTHORIZED, message: 'Unauthorized' });
    const qpSchema = zod_1.z.object({
        limit: zod_1.z.coerce.number().int().min(1).max(200).default(50),
        skip: zod_1.z.coerce.number().int().min(0).default(0),
    });
    const parsed = qpSchema.safeParse({ limit: req.query.limit, skip: req.query.skip });
    if (!parsed.success)
        return res.status(errors_1.ErrorCodes.INVALID_REQUEST).json({ code: errors_1.ErrorCodes.INVALID_REQUEST, message: 'Invalid query' });
    const { limit, skip } = parsed.data;
    try {
        if (!(0, auth_1.isDbConnected)())
            return res.json({ code: errors_1.ErrorCodes.SUCCESS, message: 'Success', data: [] });
        const rows = await db_1.WalletLedgerModel.find({ userId }).sort({ createdAt: -1 }).skip(skip).limit(limit).lean().exec();
        const data = rows.map(r => ({
            userId: r.userId,
            delta: r.delta,
            reason: r.reason,
            ref: r.ref,
            balanceAfter: r.balanceAfter,
            createdAt: r['createdAt'],
        }));
        return res.json({ code: errors_1.ErrorCodes.SUCCESS, message: 'Success', data });
    }
    catch (e) {
        return res.status(errors_1.ErrorCodes.SERVER_ERROR).json({ code: errors_1.ErrorCodes.SERVER_ERROR, message: 'error' });
    }
});
