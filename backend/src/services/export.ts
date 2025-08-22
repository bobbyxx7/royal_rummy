import { WalletLedgerModel, RoundResultModel } from '../db';

export async function ledgersToCsv(from?: Date, to?: Date, userId?: string): Promise<string> {
  const match: any = {};
  if (from || to) match.createdAt = {};
  if (from) match.createdAt.$gte = from;
  if (to) match.createdAt.$lte = to;
  if (userId) match.userId = userId;
  const rows = await WalletLedgerModel.find(match).sort({ createdAt: 1 }).lean().exec() as any[];
  const header = ['userId', 'delta', 'reason', 'ref', 'balanceAfter', 'createdAt'];
  const lines = [header.join(',')];
  for (const r of rows) {
    lines.push([
      r.userId,
      r.delta,
      r.reason,
      r.ref ?? '',
      r.balanceAfter ?? '',
      new Date(r.createdAt).toISOString(),
    ].map((v) => String(v).split('"').join('""')).map((v) => /[,"]/.test(v) ? `"${v}"` : v).join(','));
  }
  return lines.join('\n');
}

export async function rakeSummary(from?: Date, to?: Date): Promise<{ totalRake: number; rounds: number }> {
  const match: any = {};
  if (from) match.createdAt = { ...(match.createdAt || {}), $gte: from };
  if (to) match.createdAt = { ...(match.createdAt || {}), $lte: to };
  const agg = await RoundResultModel.aggregate([
    { $match: match },
    { $group: { _id: null, totalRake: { $sum: { $ifNull: ['$rake', 0] } }, rounds: { $sum: 1 } } },
  ]).exec();
  return { totalRake: Number(agg?.[0]?.totalRake || 0), rounds: Number(agg?.[0]?.rounds || 0) };
}


