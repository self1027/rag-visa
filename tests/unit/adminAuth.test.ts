import { it, expect, vi, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { adminAuth } from '../../src/middleware/adminAuth.js';
afterEach(() => vi.unstubAllEnvs());
it('keeps intranet routes open and optionally protects mutations when a token is configured', async () => {
  const app = express(); app.post('/admin', adminAuth, (_req, res) => res.sendStatus(204));
  vi.stubEnv('ADMIN_API_TOKEN', '');
  expect((await request(app).post('/admin')).status).toBe(204);
  vi.stubEnv('ADMIN_API_TOKEN', 'test-only-secret');
  expect((await request(app).post('/admin')).status).toBe(401);
  expect((await request(app).post('/admin').set('Authorization', 'Bearer wrong')).status).toBe(401);
  expect((await request(app).post('/admin').set('Authorization', 'Bearer test-only-secret')).status).toBe(204);
});
