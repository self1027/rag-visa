import type { RequestHandler } from 'express';
import { randomUUID } from 'node:crypto';
const counts = new Map<string, { requests: number; errors: number; durationMs: number }>();
export function log(event: string, fields: Record<string, unknown> = {}) {
  console.info(JSON.stringify({ timestamp: new Date().toISOString(), event, ...fields }));
}
export const observe: RequestHandler = (req, res, next) => {
  const requestId = randomUUID();
  const started = performance.now();
  res.setHeader('X-Request-Id', requestId);
  res.on('finish', () => {
    const durationMs = Math.round(performance.now() - started);
    const route = `${req.method} ${req.route?.path || 'unmatched'}`;
    const current = counts.get(route) || { requests: 0, errors: 0, durationMs: 0 };
    current.requests++; current.errors += res.statusCode >= 500 ? 1 : 0; current.durationMs += durationMs;
    counts.set(route, current);
    log('http_request', { requestId, route, status: res.statusCode, durationMs });
  });
  next();
};
export function metrics() { return Object.fromEntries(counts); }
