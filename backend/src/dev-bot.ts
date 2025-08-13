import { io } from 'socket.io-client';

const SOCKET_URL = process.env.SOCKET_URL || 'http://localhost:6969/rummy';
const USER_ID = process.env.BOT_USER_ID || `dev-bot-${Math.floor(Math.random() * 1e6)}`;
const BOOT_VALUE = String(process.env.BOOT_VALUE || '80');
const NUM_PLAYERS = String(process.env.NUM_PLAYERS || '2');

function runOnce() {
  const s = io(SOCKET_URL, { transports: ['websocket'], query: { userId: USER_ID } });
  s.on('connect', () => {
    // eslint-disable-next-line no-console
    console.log(`[bot] connected as ${USER_ID}`);
    s.emit('get-table', { user_id: USER_ID, token: 't', boot_value: BOOT_VALUE, no_of_players: NUM_PLAYERS });
  });
  s.on('get-table', (d: any) => {
    // eslint-disable-next-line no-console
    console.log('[bot] get-table', d);
    if (d && d.table_id) {
      s.emit('join-table', { user_id: USER_ID, token: 't', table_id: d.table_id });
    }
  });
  s.on('join-table', (d: any) => {
    // eslint-disable-next-line no-console
    console.log('[bot] join-table', d);
  });
  s.on('start-game', (d: any) => {
    // eslint-disable-next-line no-console
    console.log('[bot] start-game', { keys: Object.keys(d || {}) });
    setTimeout(() => process.exit(0), 500);
  });
  setTimeout(() => {
    // eslint-disable-next-line no-console
    console.log('[bot] timeout without start-game');
    process.exit(0);
  }, 15000);
}

runOnce();


