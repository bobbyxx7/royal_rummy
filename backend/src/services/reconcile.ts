import { UserModel, WalletHoldModel, WalletLedgerModel } from '../db';

export type ReconcileResult = {
  count: number;
  inconsistencies: Array<{ userId: string; wallet: number; totalDelta: number; totalHold: number; expected: number; diff: number }>;
  sample: Array<{ userId: string; wallet: number; totalDelta: number; totalHold: number; expected: number; diff: number }>;
};

export async function reconcileWallets(limit: number = 100): Promise<ReconcileResult> {
  const lim = Math.min(1000, Math.max(1, Number(limit || 100)));
  const users = await UserModel.find({}).select('wallet').limit(lim).lean().exec() as any[];
  const userIds = users.map(u => String(u._id));

  const ledgers = await WalletLedgerModel.aggregate([
    { $match: { userId: { $in: userIds } } },
    { $group: { _id: '$userId', totalDelta: { $sum: '$delta' } } },
  ]).exec();
  const holds = await WalletHoldModel.aggregate([
    { $match: { userId: { $in: userIds }, active: true } },
    { $group: { _id: '$userId', totalHold: { $sum: { $toDouble: '$amount' } } } },
  ]).exec();

  const userIdToLedger = new Map<string, number>(ledgers.map((r: any) => [String(r._id), Number(r.totalDelta || 0)]));
  const userIdToHold = new Map<string, number>(holds.map((r: any) => [String(r._id), Number(r.totalHold || 0)]));

  const results = users.map(u => {
    const uid = String(u._id);
    const wallet = Number(u.wallet || '0');
    const totalDelta = userIdToLedger.get(uid) || 0;
    const totalHold = userIdToHold.get(uid) || 0;
    const expected = Number((totalDelta - totalHold).toFixed(2));
    const diff = Number((wallet - expected).toFixed(2));
    return { userId: uid, wallet, totalDelta, totalHold, expected, diff };
  });

  const inconsistencies = results.filter(r => Math.abs(r.diff) > 0.01);
  return { count: results.length, inconsistencies, sample: results.slice(0, 20) };
}


