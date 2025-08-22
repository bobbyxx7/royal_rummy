import type { CorsOptions } from 'cors';
import { loadConfig } from '../config';

export function getCorsOptions(): CorsOptions {
  const cfg = loadConfig();
  const nodeEnv = (process.env.NODE_ENV || 'development').toLowerCase();
  const originsRaw = cfg.clientOrigin || '*';
  // Allow wildcard in non-production for convenience
  if (nodeEnv !== 'production') {
    if (originsRaw === '*' || originsRaw.trim() === '') {
      return { origin: true, credentials: true };
    }
  }
  const allowed = new Set(
    originsRaw
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0 && s !== '*'),
  );
  // If list empty (or configured to *), default to deny-all in production
  if (allowed.size === 0) {
    return { origin: false, credentials: true };
  }
  return {
    credentials: true,
    origin: (origin, callback) => {
      if (!origin) return callback(null, false);
      if (allowed.has(origin)) return callback(null, true);
      return callback(null, false);
    },
  };
}


