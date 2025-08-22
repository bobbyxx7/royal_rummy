/* Simple structured logger for socket events, enabled via LOG_SOCKETS=1 */

export const SOCKET_LOG_ENABLED: boolean = (process.env.LOG_SOCKETS ?? '0') === '1';

export function logSocket(event: string, fields?: Record<string, unknown>): void {
  if (!SOCKET_LOG_ENABLED) return;
  try {
    const requestId = (fields as any)?.requestId || undefined;
    const payload = { ts: Date.now(), type: 'socket', event, requestId, ...(fields || {}) };
    // eslint-disable-next-line no-console
    console.log(JSON.stringify(payload));
  } catch {
    // ignore logging errors
  }
}


