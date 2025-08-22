import http from 'http';
import express from 'express';
import request from 'supertest';
import { Server } from 'socket.io';
import { io as Client } from 'socket.io-client';
import * as auth from '../auth';
import { rummyNamespace } from '../socket/rummy.namespace';
import { adminRouter } from '../services/admin.routes';
import { testRouter } from '../services/test.routes';

jest.setTimeout(30000);

describe('Pool format progression', () => {
  let httpServer: http.Server;
  let app: express.Express;
  let ioServer: Server;
  let addr: any;

  beforeAll((done) => {
    process.env.TURN_MS = '600';
    process.env.TEST_DISABLE_TIMERS = '1';
    process.env.POINT_VALUE = '1';
    process.env.MAX_POINTS = '80';
    process.env.MIDDLE_DROP = '40';
    process.env.FIRST_DROP = '20';
    process.env.RAKE_PERCENT = '0';
    process.env.AUTO_FILL_BOT = '0';
    process.env.TOSS_JOIN_ORDER = '1';
    process.env.POOL_MAX_POINTS = '20';
    process.env.ADMIN_TOKEN = 'test-admin';
    app = express();
    app.use(express.json());
    app.use('/api/admin', adminRouter);
    app.use('/api/test', testRouter);
    httpServer = http.createServer(app);
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

  test.skip('emits pool-progress with eliminated after pack', async () => {
    jest.spyOn(auth, 'isDbConnected').mockReturnValue(false as any);
    jest.spyOn(auth, 'validateUserToken').mockResolvedValue(true as any);

    const url = `http://localhost:${addr.port}/rummy`;
    const c1 = Client(url, { transports: ['websocket'], query: { userId: 'p1', token: 't1' } });
    const c2 = Client(url, { transports: ['websocket'], query: { userId: 'p2', token: 't2' } });

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        try { c1.close(); c2.close(); } catch {}
        reject(new Error('pool-progress not emitted'));
      }, 6000);

      let sawStartGame = false;
      let sawStatusStarted = false;
      let tableId: string | undefined;
      let interval: any;
      const maybeTrigger = () => {
        if (!interval && sawStartGame && sawStatusStarted) {
          interval = setInterval(() => c1.emit('test_pool_progress', {}), 80);
        }
      };
      c1.on('start-game', () => { sawStartGame = true; maybeTrigger(); });
      c1.on('status', (s: any) => {
        if (!tableId && s?.table_id) tableId = s.table_id;
        if (s?.phase === 'started') { sawStatusStarted = true; maybeTrigger(); }
      });

      // Poll admin format-state until p2 is eliminated for this table
      const poll = async () => {
        if (!tableId) return false;
        await request(`http://localhost:${addr.port}`)
          .post('/api/test/pool/advance')
          .set('x-admin-token', 'test-admin')
          .send({ tableId });
        const res = await request(`http://localhost:${addr.port}`)
          .get('/api/admin/format-state')
          .set('x-admin-token', 'test-admin');
        const pool = (res.body?.data?.pool ?? []) as any[];
        const row = pool.find((d) => d.tableId === tableId);
        return !!row && Array.isArray(row.eliminated) && row.eliminated.includes('p2');
      };
      (async () => {
        for (let i = 0; i < 80; i++) {
          try {
            const done = await poll();
            if (done) {
              clearTimeout(timeout);
              try { if (interval) clearInterval(interval); } catch {}
              try { c1.close(); c2.close(); } catch {}
              return resolve();
            }
          } catch {}
          await new Promise(r => setTimeout(r, 100));
        }
        clearTimeout(timeout);
        try { if (interval) clearInterval(interval); } catch {}
        try { c1.close(); c2.close(); } catch {}
        reject(new Error('p2 not eliminated in pool format'));
      })();

      c1.on('connect', () => {
        c1.emit('get-table', { user_id: 'p1', token: 't1', boot_value: '0', no_of_players: 2, format: 'pool' });
      });
      c2.on('connect', () => {
        c2.emit('get-table', { user_id: 'p2', token: 't2', boot_value: '0', no_of_players: 2, format: 'pool' });
      });
      c1.on('get-table', (data: any) => c1.emit('join-table', { user_id: 'p1', token: 't1', table_id: data.table_id }));
      c2.on('get-table', (data: any) => c2.emit('join-table', { user_id: 'p2', token: 't2', table_id: data.table_id }));
    });
  });
});


