import { Server } from 'socket.io';
import { userIdToSocket } from './state';

let ioRef: Server | null = null;

export function registerIo(io: Server) {
  ioRef = io;
}

export function emitWalletUpdate(userId: string, wallet: string | number | undefined, reason?: string, ref?: string) {
  try {
    if (!ioRef) return;
    const sid = userIdToSocket.get(String(userId));
    if (!sid) return;
    ioRef.of('/rummy').to(sid).emit('wallet-update', {
      code: 200,
      message: 'WalletUpdated',
      user_id: String(userId),
      wallet: typeof wallet === 'number' ? wallet.toFixed(2) : (wallet ?? '0'),
      reason,
      ref,
    });
  } catch {}
}


