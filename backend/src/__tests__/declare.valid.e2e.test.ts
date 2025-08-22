import http from 'http';
import { Server } from 'socket.io';
import { io as Client } from 'socket.io-client';
import * as auth from '../auth';
import { rummyNamespace } from '../socket/rummy.namespace';
import { RoundResultModel, WalletLedgerModel, UserModel, WalletHoldModel } from '../db';

jest.setTimeout(25000);

describe('valid declare end-to-end (deterministic)', () => {
  let httpServer: http.Server;
  let ioServer: Server;
  let addr: any;

  beforeAll((done) => {
    // Deterministic + fast (disable timers)
    process.env.TURN_MS = '4000';
    process.env.TEST_DISABLE_TIMERS = '1';
    process.env.POINT_VALUE = '1';
    process.env.MAX_POINTS = '80';
    process.env.RAKE_PERCENT = '0';
    process.env.AUTO_FILL_BOT = '0';
    process.env.TOSS_JOIN_ORDER = '1';
    process.env.TEST_LOOSE_DECLARE = '1';
    process.env.TEST_WILD_RANK = '5';
    // u1 hand: 3 sequences + a set (13)
    process.env.TEST_HAND_S0 = 'RP2,RP3,RP4,BP6,BP7,BP8,BL9,BL10,BLJ,RSQ,BLQ,BPQ,RPQ';
    // Give u2 any 13 (not needed explicitly; will be dealt)
    httpServer = http.createServer();
    ioServer = new Server(httpServer, { path: '/socket.io' });
    rummyNamespace(ioServer);
    httpServer.listen(() => {
      addr = httpServer.address();
      done();
    });
  });

  afterAll((done) => {
    ioServer.of('/rummy').disconnectSockets(true);
    ioServer.close(() => httpServer.close(() => done()));
  });

  test.skip('u1 declares valid, emits round-end and applies settlements', (done) => {
    jest.spyOn(auth, 'isDbConnected').mockReturnValue(true as any);
    jest.spyOn(auth, 'validateUserToken').mockResolvedValue(true as any);
    const rrSpy = jest.spyOn(RoundResultModel, 'create').mockResolvedValue({} as any);
    const wlSpy = jest.spyOn(WalletLedgerModel, 'create').mockResolvedValue({} as any);
    jest.spyOn(UserModel, 'updateOne').mockReturnValue({ exec: async () => ({}) } as any);
    jest.spyOn(UserModel, 'findById').mockImplementation((_id: any) => ({ select: () => ({ lean: () => ({ exec: async () => ({ wallet: '100.00' }) }) }) } as any));
    // stub holds APIs
    jest.spyOn(WalletHoldModel, 'findOne').mockReturnValue({ lean: () => ({ exec: async () => null }) } as any);
    jest.spyOn(WalletHoldModel, 'create').mockResolvedValue({} as any);
    jest.spyOn(WalletHoldModel, 'find').mockReturnValue({ lean: () => ({ exec: async () => [] }) } as any);
    jest.spyOn(WalletHoldModel, 'updateMany').mockReturnValue({ exec: async () => ({}) } as any);

    const url = `http://localhost:${addr.port}/rummy`;
    const c1 = Client(url, { transports: ['websocket'], query: { userId: 'u1', token: 't1' } });
    // Sequence: join u1 first, then u2 to ensure u1 gets seat 0 and first turn
    let tableId: string | undefined;
    c1.on('connect', () => {
      c1.emit('get-table', { user_id: 'u1', token: 't1', boot_value: '0', no_of_players: 2 });
    });
    c1.on('get-table', (data: any) => {
      tableId = data?.table_id;
      c1.emit('join-table', { user_id: 'u1', token: 't1', table_id: tableId });
    });

    const c2 = Client(url, { transports: ['websocket'], query: { userId: 'u2', token: 't2' } });
    // Join u2 only after u1 joined
    c1.on('join-table', () => {
      if (tableId) c2.emit('join-table', { user_id: 'u2', token: 't2', table_id: tableId });
    });

    let mySeat: number | undefined;
    c1.on('status', (s: any) => {
      if (Array.isArray(s?.seats)) mySeat = s.seats.findIndex((u: any) => u === 'u1');
      if (s?.phase === 'started' && mySeat === s?.currentTurn) {
        setTimeout(() => c1.emit('test_force_declare', {}), 50);
      }
    });

    // No further actions needed; test_force_declare will complete the round

    c1.on('round-end', (summary: any) => {
      try {
        expect(summary?.winner_user_id).toBe('u1');
        expect(rrSpy).toHaveBeenCalled();
        expect(wlSpy).toHaveBeenCalled();
        c1.close();
        c2.close();
        done();
      } catch (e) {
        c1.close();
        c2.close();
        done(e);
      }
    });
  });
});


