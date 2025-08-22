import type { Request, Response, NextFunction } from 'express';

export function profileHttp(req: Request, res: Response, next: NextFunction) {
  if ((process.env.ENABLE_PROFILING ?? '0') !== '1') return next();
  const start = Date.now();
  res.on('finish', () => {
    const ms = Date.now() - start;
    try { res.setHeader('x-response-time-ms', String(ms)); } catch {}
    try {
      // eslint-disable-next-line no-console
      console.log(JSON.stringify({ ts: Date.now(), type: 'http', path: req.path, method: req.method, status: res.statusCode, ms, requestId: (req as any).requestId }));
    } catch {}
  });
  next();
}


