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

describe('E2E/Deals Rummy - deterministic via HTTP advance', () => {
  let httpServer: http.Server;
  let app: express.Express;
  let ioServer: Server;
  let addr: any;
  const url = () => `http://localhost:${addr.port}/rummy`;

  beforeAll((done) => {
    process.env.TEST_DISABLE_TIMERS = '1';
    process.env.AUTO_FILL_BOT = '0';
    process.env.TOSS_JOIN_ORDER = '1';
    process.env.DEALS_COUNT = '2';
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

  test('deals progresses to remaining=0', async () => {
    const c1 = connectClient(url(), 'p1', 't1');
    const c2 = connectClient(url(), 'p2', 't2');

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => { try { c1.close(); c2.close(); } catch {}; reject(new Error('E2E deals timed out')); }, 25000);
      let tableId: string | undefined;
      let started = false;

      const maybe = async () => {
        if (!started || !tableId) return;
        // Drive deals rounds to completion
        for (let i = 0; i < 10; i++) {
          const res = await request(app).post('/api/test/deals/advance')
            .set('x-admin-token', 'test-admin')
            .send({ tableId, winnerUserId: 'p1' });
          const remaining = res.body?.data?.remaining ?? -1;
          if (remaining === 0) break;
        }
        // Assert format-state shows remaining 0
        for (let i = 0; i < 20; i++) {
          const fs = await request(app).get('/api/admin/format-state').set('x-admin-token', 'test-admin');
          const deals = (fs.body?.data?.deals || []) as any[];
          const row = deals.find((d) => d.tableId === tableId);
          if (row && row.remaining === 0) {
            clearTimeout(timeout);
            try { c1.close(); c2.close(); } catch {}
            return resolve();
          }
          await new Promise(r => setTimeout(r, 100));
        }
      };

      c1.on('start-game', () => {});
      c1.on('status', (s: any) => {
        if (!tableId && s?.table_id) tableId = s.table_id;
        if (s?.phase === 'started') started = true;
        maybe();
      });

      c1.on('connect', () => {
        c1.emit('get-table', { user_id: 'p1', token: 't1', boot_value: '0', no_of_players: 2, format: 'deals' });
      });
      c2.on('connect', () => {
        c2.emit('get-table', { user_id: 'p2', token: 't2', boot_value: '0', no_of_players: 2, format: 'deals' });
      });
      c1.on('get-table', (data: any) => c1.emit('join-table', { user_id: 'p1', token: 't1', table_id: data.table_id, idempotencyKey: 'idemA' }));
      c2.on('get-table', (data: any) => c2.emit('join-table', { user_id: 'p2', token: 't2', table_id: data.table_id, idempotencyKey: 'idemB' }));
    });
  });
});


