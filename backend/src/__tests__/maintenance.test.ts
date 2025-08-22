import { sweepStaleHolds, gcSnapshots } from '../services/maintenance';
import * as auth from '../auth';
import * as state from '../socket/state';
import { WalletHoldModel, WalletLedgerModel, UserModel, GameModel } from '../db';

describe('Maintenance sweepers', () => {
  beforeAll(() => { jest.spyOn(auth, 'isDbConnected').mockReturnValue(true as any); });
  afterAll(() => jest.restoreAllMocks());

  test('sweepStaleHolds releases holds for missing tables', async () => {
    (state as any).waitingTables = new Map([['t1', {}]]);
    (state as any).games = new Map([]);
    (WalletHoldModel.find as any) = jest.fn().mockReturnValue({ lean: () => ({ exec: async () => ([
      { _id: 'h1', userId: 'u1', tableId: 'tX', amount: 5, active: true },
    ]) }) });
    (WalletLedgerModel.create as any) = jest.fn().mockResolvedValue({});
    (UserModel.updateOne as any) = jest.fn().mockReturnValue({ exec: async () => ({}) });
    (WalletHoldModel.updateOne as any) = jest.fn().mockReturnValue({ exec: async () => ({}) });
    const released = await sweepStaleHolds();
    expect(released).toBe(1);
  });

  test('gcSnapshots removes game snapshots with missing tables', async () => {
    (state as any).waitingTables = new Map([['t1', {}]]);
    (GameModel.find as any) = jest.fn().mockReturnValue({ select: () => ({ lean: () => ({ exec: async () => ([
      { gameId: 'gA', tableId: 'tX' },
      { gameId: 'gB', tableId: 't1' },
    ]) }) }) });
    (GameModel.deleteOne as any) = jest.fn().mockReturnValue({ exec: async () => ({}) });
    const deleted = await gcSnapshots();
    expect(deleted).toBe(1);
  });
});


