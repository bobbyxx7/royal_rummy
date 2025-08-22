import http from 'http';
import { Server } from 'socket.io';
import { io as Client } from 'socket.io-client';
import * as auth from '../auth';
import { rummyNamespace } from '../socket/rummy.namespace';
import { UserModel, WalletHoldModel, WalletLedgerModel } from '../db';

jest.setTimeout(15000);

describe('wallet hold on join-table', () => {
  let httpServer: http.Server;
  let ioServer: Server;
  let addr: any;

  beforeAll((done) => {
    process.env.MAX_POINTS = '10';
    process.env.POINT_VALUE = '1';
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

  test('places hold, ledger entry, and wallet decrement when DB connected', (done) => {
    jest.spyOn(auth, 'isDbConnected').mockReturnValue(true as any);
    jest.spyOn(auth, 'validateUserToken').mockResolvedValue(true as any);
    const findById = jest.spyOn(UserModel, 'findById').mockImplementation((id: any) => {
      return {
        select: () => ({ lean: () => ({ exec: async () => ({ wallet: '100.00' }) }) }),
      } as any;
    });
    const findOne = jest.spyOn(WalletHoldModel, 'findOne').mockReturnValue({ lean: () => ({ exec: async () => null }) } as any);
    const createHold = jest.spyOn(WalletHoldModel, 'create').mockResolvedValue({} as any);
    const createLedger = jest.spyOn(WalletLedgerModel, 'create').mockResolvedValue({} as any);
    const updateOne = jest.spyOn(UserModel, 'updateOne').mockReturnValue({ exec: async () => ({}) } as any);

    const url = `http://localhost:${addr.port}/rummy`;
    const client = Client(url, { transports: ['websocket'], query: { userId: 'u1', token: 't' } });

    client.on('connect', () => {
      client.emit('get-table', { user_id: 'u1', token: 't', boot_value: '0', no_of_players: 2 });
    });

    client.on('get-table', (data: any) => {
      client.emit('join-table', { user_id: 'u1', token: 't', table_id: data.table_id });
      setTimeout(() => {
        try {
          expect(createHold).toHaveBeenCalled();
          expect(createLedger).toHaveBeenCalled();
          expect(updateOne).toHaveBeenCalled();
          client.close();
          done();
        } catch (e) {
          client.close();
          done(e);
        }
      }, 100);
    });
  });
});


