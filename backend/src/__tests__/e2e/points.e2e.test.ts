import http from 'http';
import express from 'express';
import request from 'supertest';
import { Server } from 'socket.io';
import { rummyNamespace } from '../../socket/rummy.namespace';
import * as auth from '../../auth';
import { connectClient } from '../helpers/e2e';
import { adminRouter } from '../../services/admin.routes';
import { testRouter } from '../../services/test.routes';
import { RoundResultModel, WalletLedgerModel, UserModel, WalletHoldModel } from '../../db';

jest.setTimeout(40000);

describe('E2E/Points Rummy - deterministic round end', () => {
  let httpServer: http.Server;
  let app: express.Express;
  let ioServer: Server;
  let addr: any;
  const url = () => `http://localhost:${addr.port}/rummy`;

  beforeAll((done) => {
    // Deterministic + fast
    process.env.TURN_MS = '4000';
    process.env.POINT_VALUE = '0';
    process.env.MAX_POINTS = '0';
    process.env.RAKE_PERCENT = '0';
    process.env.AUTO_FILL_BOT = '0';
    process.env.TOSS_JOIN_ORDER = '1';
    process.env.TEST_DISABLE_TIMERS = '1';
    jest.spyOn(auth, 'validateUserToken').mockResolvedValue(true as any);
    jest.spyOn(auth, 'isDbConnected').mockReturnValue(false as any);
    process.env.ADMIN_TOKEN = 'test-admin';
    app = express();
    app.use(express.json());
    app.use('/api/admin', adminRouter);
    app.use('/api/test', testRouter);
    httpServer = http.createServer(app);
    ioServer = new Server(httpServer, { path: '/socket.io' });
    rummyNamespace(ioServer);
    httpServer.listen(() => { addr = httpServer.address(); done(); });
  });

  afterAll((done) => {
    ioServer.of('/rummy').disconnectSockets(true);
    ioServer.close(() => httpServer.close(() => done()));
  });

  test('round ends deterministically via test_force_declare', async () => {
    let forceDeclared = false;
    jest.spyOn(RoundResultModel, 'create').mockImplementation(async () => { forceDeclared = true; return {} as any; });
    jest.spyOn(RoundResultModel as any, 'find').mockReturnValue({
      sort: () => ({
        limit: () => ({
          lean: () => ({ exec: async () => (forceDeclared ? [{ winnerUserId: 'p1', points: [{ user_id: 'p1', delta: 1 }, { user_id: 'p2', delta: -1 }] }] : []) })
        })
      })
    } as any);
    jest.spyOn(WalletLedgerModel, 'create').mockResolvedValue({} as any);
    jest.spyOn(UserModel, 'updateOne').mockReturnValue({ exec: async () => ({}) } as any);
    jest.spyOn(UserModel, 'findById').mockImplementation((_id: any) => ({ select: () => ({ lean: () => ({ exec: async () => ({ wallet: '100.00' }) }) }) }) as any);
    // No DB ops in join flow when isDbConnected=false; leaving holds mocks unused

    const c1 = connectClient(url(), 'p1', 't1');
    const c2 = connectClient(url(), 'p2', 't2');

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => { try { c1.close(); c2.close(); } catch {}; reject(new Error('E2E points timed out')); }, 30000);
      let gameId: string | undefined;
      let started = false;
      let tableId: string | undefined;

      const maybe = async () => {
        if (started && gameId && tableId) {
          // bind session/seat once before declare
          try { c1.emit('status', { user_id: 'p1', token: 't1', game_id: gameId }); } catch {}
          // drive end via admin endpoint
          setTimeout(async () => {
            try {
              await request(app).post('/api/test/points/force-declare').set('x-admin-token', 'test-admin').send({ tableId, userId: 'p1' });
            } catch {}
          }, 50);
          // also try admin search loop to confirm completion
          for (let i = 0; i < 80; i++) {
            try {
              // If we have observed RoundResultModel.create, short-circuit
              if (forceDeclared) {
                clearTimeout(timeout);
                try { c1.close(); c2.close(); } catch {}
                return resolve();
              }
              const res = await request(app)
                .get(`/api/admin/rounds/search?tableId=${tableId}&limit=1`)
                .set('x-admin-token', 'test-admin');
              if ((res.body?.data || []).length > 0) {
                clearTimeout(timeout);
                try { c1.close(); c2.close(); } catch {}
                return resolve();
              }
            } catch {}
            await new Promise(r => setTimeout(r, 100));
          }
        }
      };

      c1.on('start-game', (sg: any) => {
        if (!gameId && sg?.game_id) gameId = sg.game_id;
        maybe();
      });
      c1.on('status', (s: any) => {
        if (!gameId && s?.game_id) gameId = s.game_id;
        if (!tableId && s?.table_id) tableId = s.table_id;
        if (s?.phase === 'started') { started = true; }
        maybe();
      });
      c1.on('round-end', () => {
        clearTimeout(timeout);
        try { c1.close(); c2.close(); } catch {}
        resolve();
      });

      // Poll admin rounds to avoid reliance on broadcast timing
      (async () => {
        for (let i = 0; i < 80; i++) {
          try {
            if (!tableId) { await new Promise(r => setTimeout(r, 100)); continue; }
            if (forceDeclared) {
              clearTimeout(timeout);
              try { c1.close(); c2.close(); } catch {}
              return resolve();
            }
            const res = await request(app)
              .get(`/api/admin/rounds/search?tableId=${tableId}&limit=1`)
              .set('x-admin-token', 'test-admin');
            if ((res.body?.data || []).length > 0) {
              clearTimeout(timeout);
              try { c1.close(); c2.close(); } catch {}
              return resolve();
            }
          } catch {}
          await new Promise(r => setTimeout(r, 100));
        }
      })();

      // Fallback driver: if we didn't see started, try to detect game via admin and force declare
      (async () => {
        for (let i = 0; i < 80; i++) {
          try {
            if (forceDeclared) return;
            if (!tableId) {
              const g = await request(app).get('/api/admin/games').set('x-admin-token', 'test-admin');
              const first = (g.body?.data || [])[0];
              if (first?.tableId) tableId = first.tableId;
            }
            if (tableId && !forceDeclared) {
              await request(app).post('/api/test/points/force-declare').set('x-admin-token', 'test-admin').send({ tableId, userId: 'p1' });
              return;
            }
          } catch {}
          await new Promise(r => setTimeout(r, 100));
        }
      })();

      c1.on('connect', () => {
        c1.emit('get-table', { user_id: 'p1', token: 't1', boot_value: '0', no_of_players: 2, format: 'points' });
      });
      c2.on('connect', () => {
        c2.emit('get-table', { user_id: 'p2', token: 't2', boot_value: '0', no_of_players: 2, format: 'points' });
      });
      c1.on('get-table', (data: any) => c1.emit('join-table', { user_id: 'p1', token: 't1', table_id: data.table_id, idempotencyKey: 'idemA' }));
      c2.on('get-table', (data: any) => c2.emit('join-table', { user_id: 'p2', token: 't2', table_id: data.table_id, idempotencyKey: 'idemB' }));
    });
  });
});


