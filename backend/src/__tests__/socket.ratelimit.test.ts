import http from 'http';
import { Server } from 'socket.io';
import { io as Client } from 'socket.io-client';
import * as auth from '../auth';
import { rummyNamespace } from '../socket/rummy.namespace';

jest.setTimeout(20000);

describe('Per-socket rate limiting (status event)', () => {
  let httpServer: http.Server;
  let ioServer: Server;
  let addr: any;

  beforeAll((done) => {
    jest.spyOn(auth, 'validateUserToken').mockResolvedValue(true as any);
    httpServer = http.createServer();
    ioServer = new Server(httpServer, { path: '/socket.io' });
    rummyNamespace(ioServer);
    httpServer.listen(() => { addr = httpServer.address(); done(); });
  });

  afterAll((done) => {
    ioServer.of('/rummy').disconnectSockets(true);
    ioServer.close(() => httpServer.close(() => done()));
  });

  test('burst status emits are limited within 500ms window', async () => {
    const url = `http://localhost:${addr.port}/rummy`;
    const c1 = Client(url, { transports: ['websocket'], query: { userId: 'u1', token: 't1' } });
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => { try { c1.close(); } catch {}; reject(new Error('rate-limit test timeout')); }, 5000);
      let count = 0;
      c1.on('status', () => { count += 1; });
      c1.on('connect', () => {
        // Fire 5 rapid status requests (<500ms), expect only the first to be processed
        for (let i = 0; i < 5; i++) {
          c1.emit('status', { user_id: 'u1', token: 't1', game_id: 'nope' });
        }
        setTimeout(() => {
          try {
            expect(count).toBe(1);
          } catch (e) {
            clearTimeout(timeout);
            try { c1.close(); } catch {};
            return reject(e);
          }
          // After window passes, another should be allowed
          setTimeout(() => {
            c1.emit('status', { user_id: 'u1', token: 't1', game_id: 'nope' });
            setTimeout(() => {
              try {
                expect(count).toBe(2);
                clearTimeout(timeout);
                try { c1.close(); } catch {};
                resolve();
              } catch (e) {
                clearTimeout(timeout);
                try { c1.close(); } catch {};
                reject(e);
              }
            }, 120);
          }, 520);
        }, 200);
      });
    });
  });
});


