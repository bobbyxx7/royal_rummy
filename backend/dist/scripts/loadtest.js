"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const socket_io_client_1 = require("socket.io-client");
const URL = process.env.LOAD_URL || 'http://localhost:8844/rummy';
const CLIENTS = Math.max(1, Number(process.env.LOAD_CLIENTS || 50));
async function main() {
    const clients = [];
    let connected = 0;
    for (let i = 0; i < CLIENTS; i++) {
        const c = (0, socket_io_client_1.io)(URL, { transports: ['websocket'], query: { userId: `lt_${i}`, token: 't' } });
        c.on('connect', () => { connected++; });
        clients.push(c);
    }
    const start = Date.now();
    await new Promise((resolve) => setTimeout(resolve, 3000));
    // eslint-disable-next-line no-console
    console.log(JSON.stringify({ clients: CLIENTS, connected, ms: Date.now() - start }));
    clients.forEach((c) => { try {
        c.close();
    }
    catch { } });
}
main().catch((e) => { console.error(e); process.exit(1); });
