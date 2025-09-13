"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerIo = registerIo;
exports.emitWalletUpdate = emitWalletUpdate;
const state_1 = require("./state");
let ioRef = null;
function registerIo(io) {
    ioRef = io;
}
function emitWalletUpdate(userId, wallet, reason, ref) {
    try {
        if (!ioRef)
            return;
        const sid = state_1.userIdToSocket.get(String(userId));
        if (!sid)
            return;
        ioRef.of('/rummy').to(sid).emit('wallet-update', {
            code: 200,
            message: 'WalletUpdated',
            user_id: String(userId),
            wallet: typeof wallet === 'number' ? wallet.toFixed(2) : (wallet ?? '0'),
            reason,
            ref,
        });
    }
    catch { }
}
