import { io as Client } from 'socket.io-client';

const URL = process.env.LOAD_URL || 'http://localhost:6969/rummy';
const CLIENTS = Math.max(1, Number(process.env.LOAD_CLIENTS || 50));

async function main() {
  const clients: any[] = [];
  let connected = 0;
  for (let i = 0; i < CLIENTS; i++) {
    const c = Client(URL, { transports: ['websocket'], query: { userId: `lt_${i}`, token: 't' } });
    c.on('connect', () => { connected++; });
    clients.push(c);
  }
  const start = Date.now();
  await new Promise((resolve) => setTimeout(resolve, 3000));
  // eslint-disable-next-line no-console
  console.log(JSON.stringify({ clients: CLIENTS, connected, ms: Date.now() - start }));
  clients.forEach((c) => { try { c.close(); } catch {} });
}

main().catch((e) => { console.error(e); process.exit(1); });


