import http from 'http';
import express from 'express';
import request from 'supertest';
import { Server } from 'socket.io';
import { rummyNamespace } from '../../socket/rummy.namespace';
import * as auth from '../../auth';
import { connectClient } from '../helpers/e2e';
import { adminRouter } from '../../services/admin.routes';
import { testRouter } from '../../services/test.routes';

jest.setTimeout(30000);

describe('E2E/Pool Rummy - deterministic via HTTP advance', () => {
  let httpServer: http.Server;
  let app: express.Express;
  let ioServer: Server;
  let addr: any;
  const url = () => `http://localhost:${addr.port}/rummy`;

  beforeAll((done) => {
    process.env.TEST_DISABLE_TIMERS = '1';
    process.env.AUTO_FILL_BOT = '0';
    process.env.TOSS_JOIN_ORDER = '1';
    process.env.POOL_MAX_POINTS = '1';
    process.env.MIDDLE_DROP = '1';
    process.env.MAX_POINTS = '1';
    process.env.RAKE_PERCENT = '0';
    process.env.ADMIN_TOKEN = 'test-admin';
    jest.spyOn(auth, 'validateUserToken').mockResolvedValue(true as any);
    jest.spyOn(auth, 'isDbConnected').mockReturnValue(false as any);
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

  test('pool progresses and eliminates to single winner', async () => {
    const c1 = connectClient(url(), 'p1', 't1');
    const c2 = connectClient(url(), 'p2', 't2');

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => { try { c1.close(); c2.close(); } catch {}; reject(new Error('E2E pool timed out')); }, 25000);
      let tableId: string | undefined;
      let started = false;

      const maybe = async () => {
        if (!started || !tableId) return;
        // Drive pool rounds to elimination
        for (let i = 0; i < 100; i++) {
          const g = await request(app).get('/api/admin/games').set('x-admin-token', 'test-admin');
          const anyGame = (g.body?.data || []).find((gg: any) => gg.tableId === tableId);
          if (!anyGame) { await new Promise(r => setTimeout(r, 100)); continue; }
          const adv = await request(app).post('/api/test/pool/advance')
            .set('x-admin-token', 'test-admin')
            .send({ tableId, winnerUserId: 'p1' });
          if (adv.status !== 200) { await new Promise(r => setTimeout(r, 50)); continue; }
          const eliminatedResp = new Set<string>((adv.body?.data?.eliminated || []));
          if (eliminatedResp.size >= 1) {
            clearTimeout(timeout);
            try { c1.close(); c2.close(); } catch {}
            return resolve();
          }
          const fs = await request(app).get('/api/admin/format-state').set('x-admin-token', 'test-admin');
          const pool = (fs.body?.data?.pool || []) as any[];
          const row = pool.find((d) => d.tableId === tableId);
          const eliminated = new Set<string>((row?.eliminated || []));
          const playersLeft = 2 - eliminated.size;
          if (playersLeft <= 1) {
            clearTimeout(timeout);
            try { c1.close(); c2.close(); } catch {}
            return resolve();
          }
          await new Promise(r => setTimeout(r, 50));
        }
      };

      c1.on('status', (s: any) => {
        if (!tableId && s?.table_id) tableId = s.table_id;
        if (s?.phase === 'started') started = true;
        maybe();
      });

      c1.on('connect', () => {
        c1.emit('get-table', { user_id: 'p1', token: 't1', boot_value: '0', no_of_players: 2, format: 'pool' });
      });
      c2.on('connect', () => {
        c2.emit('get-table', { user_id: 'p2', token: 't2', boot_value: '0', no_of_players: 2, format: 'pool' });
      });
      c1.on('get-table', (data: any) => c1.emit('join-table', { user_id: 'p1', token: 't1', table_id: data.table_id, idempotencyKey: 'idemA' }));
      c2.on('get-table', (data: any) => c2.emit('join-table', { user_id: 'p2', token: 't2', table_id: data.table_id, idempotencyKey: 'idemB' }));

      // Fallback: if started/tableId not observed, pull from admin and advance anyway
      (async () => {
        for (let i = 0; i < 80; i++) {
          try {
            if (!tableId) {
              const g = await request(app).get('/api/admin/games').set('x-admin-token', 'test-admin');
              const first = (g.body?.data || [])[0];
              if (first?.tableId) tableId = first.tableId;
            }
            if (tableId) {
              const adv = await request(app).post('/api/test/pool/advance')
                .set('x-admin-token', 'test-admin')
                .send({ tableId, winnerUserId: 'p1' });
              const eliminatedResp = new Set<string>((adv.body?.data?.eliminated || []));
              if (eliminatedResp.size >= 1) {
                clearTimeout(timeout);
                try { c1.close(); c2.close(); } catch {}
                return resolve();
              }
            }
          } catch {}
          await new Promise(r => setTimeout(r, 100));
        }
      })();
    });
  });
});


