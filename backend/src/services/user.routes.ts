import { Router } from 'express';
import { z } from 'zod';
import { usersById } from './auth.routes';
import { UserModel } from '../db';
import { isDbConnected } from '../auth';
import { ErrorCodes } from '../errors';
import { emitWalletUpdate } from '../socket/emitter';

const router = Router();

const updateSchema = z.object({
  user_id: z.string().min(1),
  name: z.string().optional(),
  gender: z.string().optional(),
  referral_code: z.string().optional(),
  user_type: z.string().optional(),
  amount: z.string().optional(), // wallet delta as string from client
});

// POST /api/user/update_user_data
router.post('/update_user_data', (req, res) => {
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(ErrorCodes.INVALID_REQUEST).json({ code: ErrorCodes.INVALID_REQUEST, message: 'Invalid request' });
  }

  const { user_id, name, gender, referral_code, user_type, amount } = parsed.data;

  if (isDbConnected()) {
    (async () => {
      const $set: any = {};
      if (name !== undefined) $set.name = name;
      if (gender !== undefined) $set.gender = gender;
      if (referral_code !== undefined) $set.referral_code = referral_code;
      if (user_type !== undefined) $set.user_type = user_type;
      if (amount !== undefined) {
        // atomic wallet increment, stored as string
        const delta = Number(amount);
        await UserModel.updateOne({ _id: user_id }, [{
          $set: {
            ...$set,
            wallet: {
              $toString: { $round: [{ $add: [{ $toDouble: '$wallet' }, Number.isFinite(delta) ? delta : 0] }, 2] }
            }
          }
        }]).exec().catch(() => {});
      } else {
        await UserModel.updateOne({ _id: user_id }, { $set }).exec().catch(() => {});
      }
      const dbUser = await UserModel.findById(user_id).lean().exec() as any;
      if (!dbUser) return res.status(ErrorCodes.NOT_FOUND).json({ code: ErrorCodes.NOT_FOUND, message: 'User not found' });
      if (amount !== undefined) {
        try { emitWalletUpdate(String(user_id), String(dbUser.wallet), 'user_update', 'update_user_data'); } catch {}
      }
      return res.json({ code: ErrorCodes.SUCCESS, message: 'Success', user_data: [{
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
  const user = usersById.get(user_id);
  if (!user) {
    return res.status(ErrorCodes.NOT_FOUND).json({ code: ErrorCodes.NOT_FOUND, message: 'User not found' });
  }
  if (name !== undefined) user.name = name;
  if (gender !== undefined) user.gender = gender;
  if (referral_code !== undefined) user.referral_code = referral_code;
  if (user_type !== undefined) user.user_type = user_type;
  if (amount !== undefined) {
    const delta = Number(amount);
    const current = Number(user.wallet || '0');
    const updated = current + (Number.isFinite(delta) ? delta : 0);
    user.wallet = updated.toFixed(2);
  }
  return res.json({ code: ErrorCodes.SUCCESS, message: 'Success', user_data: [{
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

export { router as userRouter };


