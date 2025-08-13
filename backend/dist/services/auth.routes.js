"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.usersById = exports.authRouter = void 0;
const express_1 = require("express");
const zod_1 = require("zod");
const uuid_1 = require("uuid");
const router = (0, express_1.Router)();
exports.authRouter = router;
const usersByMobile = new Map();
const usersById = new Map();
exports.usersById = usersById;
// shared helpers
function ensureUserFromBody(body) {
    const id = (0, uuid_1.v4)();
    const token = (0, uuid_1.v4)().replace(/-/g, '');
    const user = {
        id,
        name: body.name ?? '',
        mobile: String(body.mobile ?? ''),
        passwordHash: String(body.password ?? ''),
        gender: body.gender ?? '',
        referral_code: body.referral_code ?? '',
        user_type: body.user_type ?? '',
        wallet: '0',
        token,
    };
    usersByMobile.set(user.mobile, user);
    usersById.set(user.id, user);
    return user;
}
const loginSchema = zod_1.z.object({
    mobile: zod_1.z.string().min(1),
    password: zod_1.z.string().min(1),
});
// POST /api/user/login
router.post('/login', (req, res) => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
        return res.status(400).json({ code: 400, message: 'Invalid request' });
    }
    const { mobile, password } = parsed.data;
    const existing = usersByMobile.get(mobile);
    if (!existing) {
        // For dev, auto-create user on first login to unblock frontend flows
        const user = ensureUserFromBody({ name: '', mobile, password });
        return res.json({
            code: 200,
            message: 'Success',
            user_data: [
                {
                    id: user.id,
                    name: user.name,
                    mobile: user.mobile,
                    token: user.token,
                    wallet: user.wallet,
                    gender: user.gender ?? '',
                    referral_code: user.referral_code ?? '',
                    user_type: user.user_type ?? '',
                },
            ],
        });
    }
    if (existing.passwordHash !== password) {
        return res.status(401).json({ code: 401, message: 'Invalid credentials' });
    }
    return res.json({
        code: 200,
        message: 'Success',
        user_data: [
            {
                id: existing.id,
                name: existing.name,
                mobile: existing.mobile,
                token: existing.token,
                wallet: existing.wallet,
                gender: existing.gender ?? '',
                referral_code: existing.referral_code ?? '',
                user_type: existing.user_type ?? '',
            },
        ],
    });
});
const sendOtpSchema = zod_1.z.object({
    mobile: zod_1.z.string().min(1),
    type: zod_1.z.string().min(1),
});
// POST /api/user/send_otp
router.post('/send_otp', (req, res) => {
    const parsed = sendOtpSchema.safeParse(req.body);
    if (!parsed.success) {
        return res.status(400).json({ code: 400, message: 'Invalid request' });
    }
    // Simulate OTP flow: return an otp_id
    const otp_id = (0, uuid_1.v4)();
    res.setHeader('set-cookie', `ci_session=${(0, uuid_1.v4)()}; Path=/; HttpOnly`);
    return res.json({ code: 200, message: 'Success', otp_id });
});
const registerSchema = zod_1.z.object({
    name: zod_1.z.string().min(1),
    mobile: zod_1.z.string().min(1),
    otp_id: zod_1.z.string().min(1),
    password: zod_1.z.string().min(1),
    gender: zod_1.z.string().optional(),
    referral_code: zod_1.z.string().optional(),
});
// POST /api/user/register
router.post('/register', (req, res) => {
    const parsed = registerSchema.safeParse(req.body);
    if (!parsed.success) {
        return res.status(400).json({ code: 400, message: 'Invalid request' });
    }
    const { name, mobile, password, gender, referral_code } = parsed.data;
    const existing = usersByMobile.get(mobile);
    if (existing) {
        return res.status(409).json({ code: 409, message: 'Mobile already registered' });
    }
    const user = ensureUserFromBody({ name, mobile, password, gender, referral_code });
    return res.json({ code: 200, message: 'Success', user_id: user.id, token: user.token });
});
