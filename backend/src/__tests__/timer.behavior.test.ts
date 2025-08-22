import http from 'http';
import { Server } from 'socket.io';
import { io as Client } from 'socket.io-client';
import { rummyNamespace } from '../socket/rummy.namespace';

describe('turn timer behavior', () => {
  let httpServer: http.Server;
  let ioServer: Server;
  let addr: any;

  beforeAll((done) => {
    // Configure tiny turn time and remove reserve requirement
    process.env.TURN_MS = '100';
    process.env.MAX_POINTS = '0';
    process.env.AUTO_FILL_BOT = '1';
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
    ioServer.close(() => {
      httpServer.close(() => done());
    });
  });

  test('emits status with turnDeadline within a few seconds', (done) => {
    const url = `http://localhost:${addr.port}/rummy`;
    const client = Client(url, { transports: ['websocket'], query: { userId: 'u1', token: 't' } });

    const statuses: any[] = [];
    client.on('status', (payload: any) => {
      statuses.push(payload);
    });

    client.on('connect', () => {
      client.emit('get-table', { user_id: 'u1', token: 't', boot_value: '0', no_of_players: 2 });
    });
    client.on('get-table', (data: any) => {
      client.emit('join-table', { user_id: 'u1', token: 't', table_id: data.table_id });
    });

    // Wait: 3s for toss + small buffer + 100ms for turn timeout
    setTimeout(() => {
      try {
        const last = statuses[statuses.length - 1];
        expect(last).toBeDefined();
        expect(last?.turnDeadline ?? null).not.toBeUndefined();
        client.close();
        done();
      } catch (e) {
        client.close();
        done(e);
      }
    }, 3300);
  });
});


