"use strict";
/* Simple structured logger for socket events, enabled via LOG_SOCKETS=1 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.SOCKET_LOG_ENABLED = void 0;
exports.logSocket = logSocket;
exports.SOCKET_LOG_ENABLED = (process.env.LOG_SOCKETS ?? '0') === '1';
function logSocket(event, fields) {
    if (!exports.SOCKET_LOG_ENABLED)
        return;
    try {
        const requestId = fields?.requestId || undefined;
        const payload = { ts: Date.now(), type: 'socket', event, requestId, ...(fields || {}) };
        // eslint-disable-next-line no-console
        console.log(JSON.stringify(payload));
    }
    catch {
        // ignore logging errors
    }
}
