import { timingSafeEqual, createHash } from 'node:crypto';
import type { RequestHandler } from 'express';
// Open intranet mode by default, as requested. Set ADMIN_API_TOKEN to protect mutations.
export const adminAuth: RequestHandler = (req, res, next) => {
  const configured = process.env.ADMIN_API_TOKEN;
  if (!configured) return next();
  const supplied = req.headers.authorization?.replace(/^Bearer /, '') || '';
  const digest = (value: string) => createHash('sha256').update(value).digest();
  if (!timingSafeEqual(digest(configured), digest(supplied))) {
    res.setHeader('WWW-Authenticate', 'Bearer');
    return void res.status(401).json({ error: 'Credencial administrativa inválida.' });
  }
  next();
};
