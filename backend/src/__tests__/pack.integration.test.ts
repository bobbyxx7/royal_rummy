import http from 'http';
import { Server } from 'socket.io';
import { io as Client } from 'socket.io-client';
import * as auth from '../auth';
import { rummyNamespace } from '../socket/rummy.namespace';

describe('pack-game flow', () => {
  let httpServer: http.Server;
  let ioServer: Server;
  let addr: any;

  beforeAll((done) => {
    process.env.TURN_MS = '5000';
    process.env.MAX_POINTS = '0';
    process.env.POINT_VALUE = '0';
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
    ioServer.close(() => httpServer.close(() => done()));
  });

  test('user can pack and status emits Packed', (done) => {
    jest.spyOn(auth, 'isDbConnected').mockReturnValue(false as any);
    const url = `http://localhost:${addr.port}/rummy`;
    const client = Client(url, { transports: ['websocket'], query: { userId: 'u1', token: 't' } });
    let gameId: string | undefined;
    let packedSeen = false;
    let startedSeen = false;

    client.on('start-game', (data: any) => {
      if (!gameId && data?.game_id) gameId = data.game_id;
    });
    client.on('status', (data: any) => {
      if (!gameId && data?.game_id) gameId = data.game_id;
      if (!startedSeen && data?.phase === 'started' && data?.game_id) {
        startedSeen = true;
        setTimeout(() => client.emit('pack-game', { game_id: data.game_id }), 100);
      }
      if (data?.message === 'Packed') packedSeen = true;
    });

    // status handler above

    client.on('connect', () => {
      client.emit('get-table', { user_id: 'u1', token: 't', boot_value: '0', no_of_players: 2 });
    });
    client.on('get-table', (data: any) => {
      client.emit('join-table', { user_id: 'u1', token: 't', table_id: data.table_id });
    });

    setTimeout(() => {
      try {
        expect(gameId).toBeDefined();
        expect(packedSeen).toBe(true);
        client.close();
        done();
      } catch (e) {
        client.close();
        done(e);
      }
    }, 4000);
  });
});


