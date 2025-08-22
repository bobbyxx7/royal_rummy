import 'dotenv/config';
import { connectMongo } from '../db';
import { loadConfig } from '../config';
import { reconcileWallets } from '../services/reconcile';

export async function runReconcile(): Promise<void> {
  const cfg = loadConfig();
  if (!cfg.mongoUri) {
    // eslint-disable-next-line no-console
    console.error('[reconcile] MONGO_URI not set');
    process.exitCode = 1;
    return;
  }
  await connectMongo(cfg.mongoUri);
  const limit = Math.min(1000, Math.max(1, Number(process.env.RECONCILE_LIMIT || 100)));
  const res = await reconcileWallets(limit);
  // eslint-disable-next-line no-console
  console.log(JSON.stringify({ ok: true, ...res }));
}

if (require.main === module) {
  runReconcile().catch((e) => {
    // eslint-disable-next-line no-console
    console.error('[reconcile] failed', e);
    process.exitCode = 1;
  });
}

export {};


