"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.userRouter = void 0;
const express_1 = require("express");
const zod_1 = require("zod");
const auth_routes_1 = require("./auth.routes");
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
        return res.status(400).json({ code: 400, message: 'Invalid request' });
    }
    const { user_id, name, gender, referral_code, user_type, amount } = parsed.data;
    const user = auth_routes_1.usersById.get(user_id);
    if (!user) {
        return res.status(404).json({ code: 404, message: 'User not found' });
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
    return res.json({ code: 200, message: 'Success', user_data: [{
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
