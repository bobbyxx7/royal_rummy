import { io } from 'socket.io-client';

const socket = io('http://localhost:6969/rummy', {
  transports: ['websocket'],
  query: { userId: 'u1' },
});

socket.on('connect', () => {
  console.log('connected');
  socket.emit('get-table', { user_id: 'u1', token: 't', boot_value: '80', no_of_players: '2' });
});

socket.on('get-table', (data: any) => {
  console.log('get-table', data);
  if (data.table_id) {
    socket.emit('join-table', { user_id: 'u1', token: 't', table_id: data.table_id });
  }
});

socket.on('join-table', (data: any) => {
  console.log('join-table', data);
});

socket.on('start-game', (data: any) => {
  console.log('start-game', Object.keys(data));
  process.exit(0);
});

setTimeout(() => process.exit(0), 5000);


