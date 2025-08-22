import http from 'http';
import { Server } from 'socket.io';
import { io as Client } from 'socket.io-client';
import * as auth from '../auth';
import { rummyNamespace } from '../socket/rummy.namespace';

describe('declare flow constraints', () => {
  let httpServer: http.Server;
  let ioServer: Server;
  let addr: any;

  beforeAll((done) => {
    process.env.TURN_MS = '3000';
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
    // Ensure all connections are closed cleanly
    ioServer.of('/rummy').disconnectSockets(true);
    ioServer.close(() => httpServer.close(() => done()));
  });

  test('declare without drawing and not on turn is rejected', (done) => {
    jest.spyOn(auth, 'isDbConnected').mockReturnValue(false as any);
    const url = `http://localhost:${addr.port}/rummy`;
    const client = Client(url, { transports: ['websocket'], query: { userId: 'u1', token: 't' } });
    let finishCard: any;

    client.on('my-card', (data: any) => {
      // pick any card in hand as finish card
      finishCard = data?.hand?.[0];
    });

    client.on('connect', () => {
      client.emit('get-table', { user_id: 'u1', token: 't', boot_value: '0', no_of_players: 2 });
    });
    client.on('get-table', (data: any) => {
      client.emit('join-table', { user_id: 'u1', token: 't', table_id: data.table_id });
    });

    client.on('declare', (resp: any) => {
      try {
        expect([400, 401, 404, 409]).toContain(resp?.code);
        client.close();
        done();
      } catch (e) {
        client.close();
        done(e);
      }
    });

    // Try declare soon after join (not our turn and no draw yet)
    setTimeout(() => {
      client.emit('declare', { groups: [], finish_card: finishCard });
    }, 1500);
  });
});


