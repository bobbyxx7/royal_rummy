"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.connectClient = connectClient;
const socket_io_client_1 = require("socket.io-client");
function connectClient(url, userId, token) {
    const c = (0, socket_io_client_1.io)(url, { transports: ['websocket'], query: { userId, token } });
    c.emitAck = (event, payload, timeoutMs = 3000) => {
        return new Promise((resolve, reject) => {
            const t = setTimeout(() => reject(new Error(`ack timeout for ${event}`)), timeoutMs);
            c.emit(event, payload, (resp) => { clearTimeout(t); resolve(resp); });
        });
    };
    c.waitFor = (event, predicate, timeoutMs = 8000) => {
        return new Promise((resolve, reject) => {
            const onEvent = (data) => {
                try {
                    if (predicate(data)) {
                        cleanup();
                        resolve(data);
                    }
                }
                catch { }
            };
            const cleanup = () => { try {
                c.off(event, onEvent);
            }
            catch { } };
            const t = setTimeout(() => { cleanup(); reject(new Error(`waitFor timeout: ${event}`)); }, timeoutMs);
            c.on(event, (d) => { try {
                if (predicate(d)) {
                    clearTimeout(t);
                    cleanup();
                    resolve(d);
                }
            }
            catch { } });
        });
    };
    c.emitIdem = (event, payload) => {
        const idem = Math.random().toString(36).slice(2);
        c.emit(event, { ...payload, idempotencyKey: idem });
    };
    return c;
}
