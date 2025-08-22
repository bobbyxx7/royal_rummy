import http from 'http';
import { Server } from 'socket.io';
import { io as Client } from 'socket.io-client';
import * as auth from '../auth';
import { rummyNamespace } from '../socket/rummy.namespace';

jest.setTimeout(20000);

describe('Socket auth enforcement', () => {
  let httpServer: http.Server;
  let ioServer: Server;
  let addr: any;

  beforeAll((done) => {
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

  test('rejects connection when validateUserToken fails', async () => {
    jest.spyOn(auth, 'validateUserToken').mockResolvedValue(false as any);
    const url = `http://localhost:${addr.port}/rummy`;
    const c1 = Client(url, { transports: ['websocket'], query: { userId: 'u1', token: 'bad' } });
    await new Promise<void>((resolve) => {
      c1.on('disconnect', () => resolve());
      c1.on('connect_error', () => resolve());
    });
  });
});


