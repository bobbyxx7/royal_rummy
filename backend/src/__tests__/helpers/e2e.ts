import { io as Client, Socket } from 'socket.io-client';

export type WrappedClient = Socket & {
  emitAck: (event: string, payload: any, timeoutMs?: number) => Promise<any>;
  waitFor: (event: string, predicate: (data: any) => boolean, timeoutMs?: number) => Promise<any>;
  emitIdem: (event: string, payload: any) => void;
};

export function connectClient(url: string, userId: string, token: string): WrappedClient {
  const c: any = Client(url, { transports: ['websocket'], query: { userId, token } });
  c.emitAck = (event: string, payload: any, timeoutMs = 3000) => {
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error(`ack timeout for ${event}`)), timeoutMs);
      c.emit(event, payload, (resp: any) => { clearTimeout(t); resolve(resp); });
    });
  };
  c.waitFor = (event: string, predicate: (data: any) => boolean, timeoutMs = 8000) => {
    return new Promise((resolve, reject) => {
      const onEvent = (data: any) => {
        try { if (predicate(data)) { cleanup(); resolve(data); } } catch {}
      };
      const cleanup = () => { try { c.off(event, onEvent); } catch {} };
      const t = setTimeout(() => { cleanup(); reject(new Error(`waitFor timeout: ${event}`)); }, timeoutMs);
      c.on(event, (d: any) => { try { if (predicate(d)) { clearTimeout(t); cleanup(); resolve(d); } } catch {} });
    });
  };
  c.emitIdem = (event: string, payload: any) => {
    const idem = Math.random().toString(36).slice(2);
    c.emit(event, { ...payload, idempotencyKey: idem });
  };
  return c as WrappedClient;
}


