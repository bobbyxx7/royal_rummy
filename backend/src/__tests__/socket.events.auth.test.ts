import http from 'http';
import { Server } from 'socket.io';
import { io as Client } from 'socket.io-client';
import * as auth from '../auth';
import { rummyNamespace } from '../socket/rummy.namespace';

jest.setTimeout(20000);

describe('Socket per-event auth (401)', () => {
  let httpServer: http.Server;
  let ioServer: Server;
  let addr: any;

  beforeAll((done) => {
    httpServer = http.createServer();
    ioServer = new Server(httpServer, { path: '/socket.io' });
    rummyNamespace(ioServer);
    httpServer.listen(() => { addr = httpServer.address(); done(); });
  });

  afterAll((done) => {
    ioServer.of('/rummy').disconnectSockets(true);
    ioServer.close(() => httpServer.close(() => done()));
  });

  test('get-table emits 401 when token invalid', async () => {
    jest.spyOn(auth, 'validateUserToken').mockResolvedValue(true as any);
    const url = `http://localhost:${addr.port}/rummy`;
    const c1 = Client(url, { transports: ['websocket'], query: { userId: 'u1', token: 't1' } });
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => { try { c1.close(); } catch {} ; reject(new Error('no 401 get-table')); }, 4000);
      c1.on('connect', async () => {
        (auth.validateUserToken as jest.Mock).mockResolvedValueOnce(false as any);
        c1.emit('get-table', { user_id: 'u1', token: 'bad', boot_value: '0', no_of_players: 2, format: 'points' });
      });
      c1.on('get-table', (res: any) => {
        try {
          expect(res?.code).toBe(401);
          clearTimeout(timeout);
          try { c1.close(); } catch {};
          resolve();
        } catch (e) {
          clearTimeout(timeout);
          try { c1.close(); } catch {};
          reject(e);
        }
      });
    });
  });

  test('status emits 401 when token invalid and DB connected', async () => {
    jest.spyOn(auth, 'validateUserToken').mockResolvedValue(true as any);
    const url = `http://localhost:${addr.port}/rummy`;
    const c1 = Client(url, { transports: ['websocket'], query: { userId: 'u2', token: 't2' } });
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => { try { c1.close(); } catch {} ; reject(new Error('no 401 status')); }, 4000);
      c1.on('connect', async () => {
        // Trigger a table and join first so status has a game_id context
        c1.emit('get-table', { user_id: 'u2', token: 't2', boot_value: '0', no_of_players: 2, format: 'points' });
      });
      let tableId: string | undefined;
      c1.on('get-table', (res: any) => {
        tableId = res?.table_id;
        if (tableId) {
          c1.emit('join-table', { user_id: 'u2', token: 't2', table_id: tableId });
        }
      });
      c1.on('join-table', () => {
        // Now make token invalid before asking status
        (auth.validateUserToken as jest.Mock).mockResolvedValueOnce(false as any);
        // game_id will be set after start-game; we can call status with a fake id to exercise 401 path
        c1.emit('status', { user_id: 'u2', token: 'bad', game_id: 'non-existent' });
      });
      c1.on('status', (res: any) => {
        try {
          if (res?.code === 401) {
            clearTimeout(timeout);
            try { c1.close(); } catch {};
            resolve();
          }
        } catch (e) {
          clearTimeout(timeout);
          try { c1.close(); } catch {};
          reject(e);
        }
      });
    });
  });
});


