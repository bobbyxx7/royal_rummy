import http from 'http';
import { Server } from 'socket.io';
import { rummyNamespace, restoreSnapshots } from '../socket/rummy.namespace';
import * as auth from '../auth';
import { TableModel, GameModel } from '../db';

jest.setTimeout(20000);

describe('Snapshot persistence & restore', () => {
  let httpServer: http.Server;
  let ioServer: Server;

  beforeAll(() => {
    jest.spyOn(auth, 'isDbConnected').mockReturnValue(true as any);
  });

  afterAll(() => jest.restoreAllMocks());

  test('restoreSnapshots resets tables to waiting and removes game snapshots', async () => {
    (TableModel.find as any) = jest.fn().mockReturnValue({ lean: () => ({ exec: async () => ([{ tableId: 't1', bootValue: '0', noOfPlayers: 2, status: 'playing', players: ['u1', 'u2'], pointValue: 1 }]) }) });
    (GameModel.find as any) = jest.fn().mockReturnValue({ select: () => ({ lean: () => ({ exec: async () => ([{ gameId: 'g1', tableId: 't1' }]) }) }) });
    (GameModel.deleteOne as any) = jest.fn().mockReturnValue({ exec: async () => ({ acknowledged: true }) });

    httpServer = http.createServer();
    ioServer = new Server(httpServer, { path: '/socket.io' });
    rummyNamespace(ioServer);

    await restoreSnapshots();

    expect((GameModel.deleteOne as any)).toHaveBeenCalled();
  });
});


