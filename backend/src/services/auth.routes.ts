import { Router } from 'express';
import { z } from 'zod';
import { v4 as uuid } from 'uuid';
import bcrypt from 'bcryptjs';
import { UserModel } from '../db';
import { isDbConnected } from '../auth';
import { ErrorCodes } from '../errors';

const router = Router();
const isProd = (process.env.NODE_ENV || '').toLowerCase() === 'production';

// In-memory user store for initial development
type User = {
  id: string;
  name: string;
  mobile: string;
  passwordHash: string; // plain for now (dev), replace with hash later
  gender?: string;
  referral_code?: string;
  user_type?: string;
  wallet: string; // store as string to match app model
  token: string;
};

const usersByMobile = new Map<string, User>();
const usersById = new Map<string, User>();

// shared helpers
function ensureUserFromBody(body: any): User {
  const id = uuid();
  const token = uuid().replace(/-/g, '');
  const user: User = {
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

const loginSchema = z.object({
  mobile: z.string().min(1),
  password: z.string().min(1),
});

// POST /api/user/login
router.post('/login', async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(ErrorCodes.INVALID_REQUEST).json({ code: ErrorCodes.INVALID_REQUEST, message: 'Invalid request' });
  }
  const { mobile, password } = parsed.data;

  // Prefer DB user if connected; fall back to in-memory only in non-production
  if (isDbConnected()) {
    const dbUser = await UserModel.findOne({ mobile }).lean().exec().catch(() => null) as any;
    if (dbUser) {
      const ok = await bcrypt.compare(password, dbUser.passwordHash).catch(() => false);
      if (!ok) return res.status(ErrorCodes.UNAUTHORIZED).json({ code: ErrorCodes.UNAUTHORIZED, message: 'Invalid credentials' });
      return res.json({
        code: ErrorCodes.SUCCESS,
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
      code: ErrorCodes.SUCCESS,
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
    return res.status(ErrorCodes.UNAUTHORIZED).json({ code: ErrorCodes.UNAUTHORIZED, message: 'Invalid credentials' });
  }

  return res.json({
    code: ErrorCodes.SUCCESS,
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

const sendOtpSchema = z.object({
  mobile: z.string().min(1),
  type: z.string().min(1),
});

// POST /api/user/send_otp
router.post('/send_otp', (req, res) => {
  const parsed = sendOtpSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(ErrorCodes.INVALID_REQUEST).json({ code: ErrorCodes.INVALID_REQUEST, message: 'Invalid request' });
  }
  // Simulate OTP flow: return an otp_id
  const otp_id = uuid();
  res.setHeader('set-cookie', `ci_session=${uuid()}; Path=/; HttpOnly`);
  return res.json({ code: ErrorCodes.SUCCESS, message: 'Success', otp_id });
});

const registerSchema = z.object({
  name: z.string().min(1),
  mobile: z.string().min(1),
  otp_id: z.string().min(1),
  password: z.string().min(1),
  gender: z.string().optional(),
  referral_code: z.string().optional(),
});

// POST /api/user/register
router.post('/register', (req, res) => {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(ErrorCodes.INVALID_REQUEST).json({ code: ErrorCodes.INVALID_REQUEST, message: 'Invalid request' });
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
      const hash = await bcrypt.hash(password, 10);
      await UserModel.create({
        name,
        mobile,
        passwordHash: hash,
        gender,
        referral_code,
        user_type: '',
        wallet: '0',
        token: user.token,
      });
    } catch {}
  })();
  return res.json({ code: ErrorCodes.SUCCESS, message: 'Success', user_id: user.id, token: user.token });
});

export { router as authRouter, usersById };


