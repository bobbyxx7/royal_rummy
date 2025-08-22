import { v4 as uuid } from 'uuid';
import type { Request, Response, NextFunction } from 'express';

export function requestId(req: Request, res: Response, next: NextFunction) {
  const id = (req.headers['x-request-id'] as string) || uuid();
  (req as any).requestId = id;
  res.setHeader('x-request-id', id);
  next();
}


