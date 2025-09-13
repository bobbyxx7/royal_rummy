"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.usersById = exports.authRouter = void 0;
const express_1 = require("express");
const zod_1 = require("zod");
const uuid_1 = require("uuid");
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const db_1 = require("../db");
const auth_1 = require("../auth");
const errors_1 = require("../errors");
const router = (0, express_1.Router)();
exports.authRouter = router;
const isProd = (process.env.NODE_ENV || '').toLowerCase() === 'production';
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
router.post('/login', async (req, res) => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
        return res.status(errors_1.ErrorCodes.INVALID_REQUEST).json({ code: errors_1.ErrorCodes.INVALID_REQUEST, message: 'Invalid request' });
    }
    const { mobile, password } = parsed.data;
    // Prefer DB user if connected; fall back to in-memory only in non-production
    if ((0, auth_1.isDbConnected)()) {
        const dbUser = await db_1.UserModel.findOne({ mobile }).lean().exec().catch(() => null);
        if (dbUser) {
            const ok = await bcryptjs_1.default.compare(password, dbUser.passwordHash).catch(() => false);
            if (!ok)
                return res.status(errors_1.ErrorCodes.UNAUTHORIZED).json({ code: errors_1.ErrorCodes.UNAUTHORIZED, message: 'Invalid credentials' });
            return res.json({
                code: errors_1.ErrorCodes.SUCCESS,
                message: 'Success',
                user_data: [
                    {
                        id: String(dbUser._id),
                        name: dbUser.name,
                        mobile: dbUser.mobile,
                        token: dbUser.token,
                        wallet: dbUser.wallet,
                        gender: dbUser.gender ?? '',
                        referral_code: dbUser.referral_code ?? '',
                        user_type: dbUser.user_type ?? '',
                    },
                ],
            });
        }
    }
    if (isProd) {
        return res.status(503).json({ code: 503, message: 'Service unavailable' });
    }
    const existing = usersByMobile.get(mobile);
    if (!existing) {
        // For dev, auto-create user on first login to unblock frontend flows
        const user = ensureUserFromBody({ name: '', mobile, password });
        return res.json({
            code: errors_1.ErrorCodes.SUCCESS,
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
        return res.status(errors_1.ErrorCodes.UNAUTHORIZED).json({ code: errors_1.ErrorCodes.UNAUTHORIZED, message: 'Invalid credentials' });
    }
    return res.json({
        code: errors_1.ErrorCodes.SUCCESS,
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
        return res.status(errors_1.ErrorCodes.INVALID_REQUEST).json({ code: errors_1.ErrorCodes.INVALID_REQUEST, message: 'Invalid request' });
    }
    // Simulate OTP flow: return an otp_id
    const otp_id = (0, uuid_1.v4)();
    res.setHeader('set-cookie', `ci_session=${(0, uuid_1.v4)()}; Path=/; HttpOnly`);
    return res.json({ code: errors_1.ErrorCodes.SUCCESS, message: 'Success', otp_id });
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
        return res.status(errors_1.ErrorCodes.INVALID_REQUEST).json({ code: errors_1.ErrorCodes.INVALID_REQUEST, message: 'Invalid request' });
    }
    const { name, mobile, password, gender, referral_code } = parsed.data;
    const existing = usersByMobile.get(mobile);
    if (existing) {
        return res.status(409).json({ code: 409, message: 'Mobile already registered' });
    }
    const user = ensureUserFromBody({ name, mobile, password, gender, referral_code });
    // Best-effort persist to DB if available
    (async () => {
        try {
            const hash = await bcryptjs_1.default.hash(password, 10);
            await db_1.UserModel.create({
                name,
                mobile,
                passwordHash: hash,
                gender,
                referral_code,
                user_type: '',
                wallet: '0',
                token: user.token,
            });
        }
        catch { }
    })();
    return res.json({ code: errors_1.ErrorCodes.SUCCESS, message: 'Success', user_id: user.id, token: user.token });
});
