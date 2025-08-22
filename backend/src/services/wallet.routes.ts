import { Router } from 'express';
import { z } from 'zod';
import { isDbConnected, validateUserToken } from '../auth';
import { UserModel, WalletLedgerModel } from '../db';
import { usersById } from './auth.routes';
import { ErrorCodes } from '../errors';

const router = Router();

function extractAuth(req: any): { userId?: string; token?: string } {
  const userId = req.header('x-user-id') || req.query.user_id || req.body?.user_id;
  const token = req.header('x-user-token') || req.query.token || req.body?.token;
  return { userId: userId ? String(userId) : undefined, token: token ? String(token) : undefined };
}

// GET /api/wallet/balance
router.get('/balance', async (req, res) => {
  const { userId, token } = extractAuth(req);
  if (!userId) return res.status(ErrorCodes.INVALID_REQUEST).json({ code: ErrorCodes.INVALID_REQUEST, message: 'user_id required' });
  const ok = await validateUserToken(userId, token);
  if (!ok) return res.status(ErrorCodes.UNAUTHORIZED).json({ code: ErrorCodes.UNAUTHORIZED, message: 'Unauthorized' });

  try {
    if (isDbConnected()) {
      const user = await UserModel.findById(userId).select('wallet').lean().exec() as any;
      return res.json({ code: ErrorCodes.SUCCESS, message: 'Success', wallet: user?.wallet ?? '0' });
    }
    const mem = usersById.get(String(userId));
    return res.json({ code: ErrorCodes.SUCCESS, message: 'Success', wallet: mem?.wallet ?? '0' });
  } catch (e) {
    return res.status(ErrorCodes.SERVER_ERROR).json({ code: ErrorCodes.SERVER_ERROR, message: 'error' });
  }
});

// GET /api/wallet/ledger?limit=50&skip=0
router.get('/ledger', async (req, res) => {
  const { userId, token } = extractAuth(req);
  if (!userId) return res.status(ErrorCodes.INVALID_REQUEST).json({ code: ErrorCodes.INVALID_REQUEST, message: 'user_id required' });
  const ok = await validateUserToken(userId, token);
  if (!ok) return res.status(ErrorCodes.UNAUTHORIZED).json({ code: ErrorCodes.UNAUTHORIZED, message: 'Unauthorized' });

  const qpSchema = z.object({
    limit: z.coerce.number().int().min(1).max(200).default(50),
    skip: z.coerce.number().int().min(0).default(0),
  });
  const parsed = qpSchema.safeParse({ limit: req.query.limit, skip: req.query.skip });
  if (!parsed.success) return res.status(ErrorCodes.INVALID_REQUEST).json({ code: ErrorCodes.INVALID_REQUEST, message: 'Invalid query' });
  const { limit, skip } = parsed.data;

  try {
    if (!isDbConnected()) return res.json({ code: ErrorCodes.SUCCESS, message: 'Success', data: [] });
    const rows = await WalletLedgerModel.find({ userId }).sort({ createdAt: -1 }).skip(skip).limit(limit).lean().exec() as any[];
    const data = rows.map(r => ({
      userId: r.userId,
      delta: r.delta,
      reason: r.reason,
      ref: r.ref,
      balanceAfter: r.balanceAfter,
      createdAt: r['createdAt'] as any,
    }));
    return res.json({ code: ErrorCodes.SUCCESS, message: 'Success', data });
  } catch (e) {
    return res.status(ErrorCodes.SERVER_ERROR).json({ code: ErrorCodes.SERVER_ERROR, message: 'error' });
  }
});

export { router as walletRouter };


