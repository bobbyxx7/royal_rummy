import http from 'http';
import { Server } from 'socket.io';
import { io as Client } from 'socket.io-client';
import * as auth from '../auth';
import { rummyNamespace } from '../socket/rummy.namespace';

jest.setTimeout(20000);

describe('Production strict auth when DB disconnected', () => {
  const OLD_ENV = process.env;
  let httpServer: http.Server;
  let ioServer: Server;
  let addr: any;

  beforeEach((done) => {
    process.env = { ...OLD_ENV };
    httpServer = http.createServer();
    ioServer = new Server(httpServer, { path: '/socket.io' });
    rummyNamespace(ioServer);
    httpServer.listen(() => { addr = httpServer.address(); done(); });
  });

  afterEach((done) => {
    ioServer.of('/rummy').disconnectSockets(true);
    ioServer.close(() => httpServer.close(() => { process.env = OLD_ENV; done(); }));
  });

  test('disconnects in production when DB is not connected', async () => {
    jest.spyOn(auth, 'isDbConnected').mockReturnValue(false as any);
    process.env.NODE_ENV = 'production';
    const url = `http://localhost:${addr.port}/rummy`;
    const c1 = Client(url, { transports: ['websocket'], query: { userId: 'u1', token: 't1' } });
    await new Promise<void>((resolve) => {
      c1.on('disconnect', () => resolve());
      c1.on('connect_error', () => resolve());
    });
  });

  test('allows connection in non-production when DB is not connected', async () => {
    jest.spyOn(auth, 'isDbConnected').mockReturnValue(false as any);
    process.env.NODE_ENV = 'development';
    const url = `http://localhost:${addr.port}/rummy`;
    const c1 = Client(url, { transports: ['websocket'], query: { userId: 'u1', token: 't1' } });
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => { try { c1.close(); } catch {}; reject(new Error('did not connect in dev')); }, 2000);
      c1.on('connect', () => { clearTimeout(timeout); try { c1.close(); } catch {}; resolve(); });
      c1.on('disconnect', () => {});
    });
  });
});


