import 'dotenv/config';
import express from 'express';
import http from 'http';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import { Server } from 'socket.io';

import { authRouter } from './services/auth.routes';
import { userRouter } from './services/user.routes';
import { connectMongo } from './db';
import { rummyNamespace } from './socket/rummy.namespace';
import { registerIo } from './socket/emitter';
import { adminRouter } from './services/admin.routes';
import { tablesRouter } from './services/tables.routes';

const app = express();
const server = http.createServer(app);

const PORT = Number(process.env.PORT || 6969);
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || '*';

// Middleware
app.use(helmet());
app.use(cors({ origin: CLIENT_ORIGIN, credentials: true }));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(morgan('dev'));

// Health
app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

// API base matching mobile app constants
// ApiConstants.apiUrl is https://syspsy.live/ and endpoints begin with /api/ and /Rummy/ and /rummy/
// We'll locally expose the same paths so the app can point to our backend by changing apiUrl.
app.use('/api/user', authRouter);
app.use('/api/user', userRouter);
app.use('/api/admin', adminRouter);
app.use('/api', tablesRouter);

const io = new Server(server, {
  cors: { origin: CLIENT_ORIGIN, credentials: true },
  path: '/socket.io',
});

// Socket namespace expected by app: '/rummy'
registerIo(io);
rummyNamespace(io);

async function start() {
  const mongoUri = process.env.MONGO_URI || '';
  if (mongoUri) {
    try {
      await connectMongo(mongoUri);
      // eslint-disable-next-line no-console
      console.log('[db] connected');
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('[db] connection failed', e);
    }
  }
  server.listen(PORT, () => {
    // eslint-disable-next-line no-console
    console.log(`Backend listening on http://localhost:${PORT}`);
  });
}

start();


