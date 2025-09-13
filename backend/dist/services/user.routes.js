"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.userRouter = void 0;
const express_1 = require("express");
const zod_1 = require("zod");
const auth_routes_1 = require("./auth.routes");
const db_1 = require("../db");
const auth_1 = require("../auth");
const errors_1 = require("../errors");
const emitter_1 = require("../socket/emitter");
const router = (0, express_1.Router)();
exports.userRouter = router;
const updateSchema = zod_1.z.object({
    user_id: zod_1.z.string().min(1),
    name: zod_1.z.string().optional(),
    gender: zod_1.z.string().optional(),
    referral_code: zod_1.z.string().optional(),
    user_type: zod_1.z.string().optional(),
    amount: zod_1.z.string().optional(), // wallet delta as string from client
});
// POST /api/user/update_user_data
router.post('/update_user_data', (req, res) => {
    const parsed = updateSchema.safeParse(req.body);
    if (!parsed.success) {
        return res.status(errors_1.ErrorCodes.INVALID_REQUEST).json({ code: errors_1.ErrorCodes.INVALID_REQUEST, message: 'Invalid request' });
    }
    const { user_id, name, gender, referral_code, user_type, amount } = parsed.data;
    if ((0, auth_1.isDbConnected)()) {
        (async () => {
            const $set = {};
            if (name !== undefined)
                $set.name = name;
            if (gender !== undefined)
                $set.gender = gender;
            if (referral_code !== undefined)
                $set.referral_code = referral_code;
            if (user_type !== undefined)
                $set.user_type = user_type;
            if (amount !== undefined) {
                // atomic wallet increment, stored as string
                const delta = Number(amount);
                await db_1.UserModel.updateOne({ _id: user_id }, [{
                        $set: {
                            ...$set,
                            wallet: {
                                $toString: { $round: [{ $add: [{ $toDouble: '$wallet' }, Number.isFinite(delta) ? delta : 0] }, 2] }
                            }
                        }
                    }]).exec().catch(() => { });
            }
            else {
                await db_1.UserModel.updateOne({ _id: user_id }, { $set }).exec().catch(() => { });
            }
            const dbUser = await db_1.UserModel.findById(user_id).lean().exec();
            if (!dbUser)
                return res.status(errors_1.ErrorCodes.NOT_FOUND).json({ code: errors_1.ErrorCodes.NOT_FOUND, message: 'User not found' });
            if (amount !== undefined) {
                try {
                    (0, emitter_1.emitWalletUpdate)(String(user_id), String(dbUser.wallet), 'user_update', 'update_user_data');
                }
                catch { }
            }
            return res.json({ code: errors_1.ErrorCodes.SUCCESS, message: 'Success', user_data: [{
                        id: String(dbUser._id),
                        name: dbUser.name,
                        mobile: dbUser.mobile,
                        token: dbUser.token,
                        wallet: dbUser.wallet,
                        gender: dbUser.gender ?? '',
                        referral_code: dbUser.referral_code ?? '',
                        user_type: dbUser.user_type ?? '',
                    }] });
        })();
        return;
    }
    // Fallback to in-memory update for dev
    const user = auth_routes_1.usersById.get(user_id);
    if (!user) {
        return res.status(errors_1.ErrorCodes.NOT_FOUND).json({ code: errors_1.ErrorCodes.NOT_FOUND, message: 'User not found' });
    }
    if (name !== undefined)
        user.name = name;
    if (gender !== undefined)
        user.gender = gender;
    if (referral_code !== undefined)
        user.referral_code = referral_code;
    if (user_type !== undefined)
        user.user_type = user_type;
    if (amount !== undefined) {
        const delta = Number(amount);
        const current = Number(user.wallet || '0');
        const updated = current + (Number.isFinite(delta) ? delta : 0);
        user.wallet = updated.toFixed(2);
    }
    return res.json({ code: errors_1.ErrorCodes.SUCCESS, message: 'Success', user_data: [{
                id: user.id,
                name: user.name,
                mobile: user.mobile,
                token: user.token,
                wallet: user.wallet,
                gender: user.gender ?? '',
                referral_code: user.referral_code ?? '',
                user_type: user.user_type ?? '',
            }] });
});
