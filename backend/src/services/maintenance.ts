import { isDbConnected } from '../auth';
import { WalletHoldModel, WalletLedgerModel, UserModel, GameModel } from '../db';
import { waitingTables, games } from '../socket/state';

/**
 * Release active holds for tables that no longer exist in memory (stale).
 * Returns number of holds released.
 */
export async function sweepStaleHolds(): Promise<number> {
  if (!isDbConnected()) return 0;
  const existingTableIds = new Set<string>([
    ...Array.from(waitingTables.keys()),
    ...Array.from(games.values()).map((g) => g.tableId),
  ]);
  const holds = await WalletHoldModel.find({ active: true }).lean().exec().catch(() => []) as any[];
  let released = 0;
  for (const h of holds) {
    const tableId = String((h as any).tableId || '');
    if (!existingTableIds.has(tableId)) {
      const amt = Number((h as any).amount || 0);
      const userId = String((h as any).userId || '');
      try {
        await WalletLedgerModel.create({ userId, delta: amt, reason: 'hold_release', ref: `sweep:${tableId}` });
        await UserModel.updateOne({ _id: userId }, [{ $set: { wallet: { $toString: { $round: [{ $add: [{ $toDouble: '$wallet' }, amt] }, 2] } } } }]).exec();
        await WalletHoldModel.updateOne({ _id: (h as any)._id }, { $set: { active: false } }).exec();
        released++;
      } catch {}
    }
  }
  return released;
}

/**
 * Remove game snapshots without corresponding tables (stale in DB).
 * Returns number of game snapshots deleted.
 */
export async function gcSnapshots(): Promise<number> {
  if (!isDbConnected()) return 0;
  const snaps = await GameModel.find({}).select('gameId tableId').lean().exec().catch(() => []) as any[];
  const existingTableIds = new Set<string>(Array.from(waitingTables.keys()));
  let deleted = 0;
  for (const g of snaps) {
    const tblId = String((g as any).tableId || '');
    if (!existingTableIds.has(tblId)) {
      try { await GameModel.deleteOne({ gameId: (g as any).gameId }).exec(); deleted++; } catch {}
    }
  }
  return deleted;
}


