import 'dotenv/config';
import express from 'express';
import http from 'http';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import { Server } from 'socket.io';

import { authRouter } from './services/auth.routes';
import { userRouter } from './services/user.routes';
import { connectMongo } from './db';
import { rummyNamespace, restoreSnapshots } from './socket/rummy.namespace';
import { teenPattiNamespace } from './socket/teenpatti.namespace';
import { registerIo } from './socket/emitter';
import { adminRouter } from './services/admin.routes';
import { tablesRouter } from './services/tables.routes';
import { walletRouter } from './services/wallet.routes';
import { loadConfig } from './config';
import { requestId } from './middleware/requestId';
import { metricsRouter } from './services/metrics.routes';
import { profileHttp } from './middleware/profile';
import { testRouter } from './services/test.routes';
import { getCorsOptions } from './services/cors';

const app = express();
const server = http.createServer(app);

const cfg = loadConfig();
const PORT = cfg.port;
const CLIENT_ORIGIN = cfg.clientOrigin;

// Middleware
app.use(helmet());
app.use(cors(getCorsOptions()));
app.use(requestId);
app.use(profileHttp);
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(morgan('dev'));
// Basic rate limiting for public APIs
const limiter = rateLimit({ windowMs: cfg.rateLimitWindowMs, max: cfg.rateLimitMax, standardHeaders: true, legacyHeaders: false });
app.use('/api/', limiter);

// Health
app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});
// Readiness (checks DB when configured)
app.get('/ready', async (_req, res) => {
  try {
    if (cfg.mongoUri) {
      await connectMongo(cfg.mongoUri);
    }
    return res.json({ status: 'ready' });
  } catch (e) {
    return res.status(500).json({ status: 'not-ready' });
  }
});

// API base matching mobile app constants
// ApiConstants.apiUrl is https://syspsy.live/ and endpoints begin with /api/ and /Rummy/ and /rummy/
// We'll locally expose the same paths so the app can point to our backend by changing apiUrl.
app.use('/api/user', authRouter);
app.use('/api/user', userRouter);
app.use('/api/admin', adminRouter);
app.use('/api', tablesRouter);
app.use('/api/wallet', walletRouter);
app.use('/api', metricsRouter);
app.use('/api/test', testRouter);

const io = new Server(server, { cors: getCorsOptions(), path: '/socket.io' });

// Socket namespaces expected by app: '/rummy' and '/teenpatti'
registerIo(io);
rummyNamespace(io);
teenPattiNamespace(io);

async function start() {
  const mongoUri = cfg.mongoUri || '';
  if (mongoUri) {
    try {
      await connectMongo(mongoUri);
      // eslint-disable-next-line no-console
      console.log('[db] connected');
      try { await restoreSnapshots(); console.log('[restore] snapshots restored'); } catch {}
      // Warn if rake configured but rake wallet not set
      const rakePct = Number(process.env.RAKE_PERCENT || 0);
      if (rakePct > 0 && !process.env.RAKE_WALLET_USER_ID) {
        // eslint-disable-next-line no-console
        console.warn('[config] RAKE_PERCENT > 0 but RAKE_WALLET_USER_ID is not set. Rake will not be credited.');
      }
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('[db] connection failed', e);
    }
  }
  server.listen(PORT, '0.0.0.0', () => {
    // eslint-disable-next-line no-console
    console.log(`Backend listening on ${cfg.baseUrl}`);
  });
}

start();


