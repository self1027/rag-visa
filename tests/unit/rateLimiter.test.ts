import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import type { RequestHandler } from 'express';

// The exported chatLimiter is a singleton with its own MemoryStore. To isolate
// the counters between tests, we reload the module on every test (vi.resetModules
// + dynamic import), obtaining an instance with zeroed storage.
let chatLimiter: RequestHandler;

async function loadFreshLimiter() {
  vi.resetModules();
  ({ chatLimiter } = await import('../../src/middleware/rateLimiter.js'));
}

// Create a test app with the rate limiter
function createTestApp() {
  const app = express();
  // O express-rate-limit usa req.ip como chave; habilitando o trust proxy em
  // loopback os testes passam a controlar o IP de origem via X-Forwarded-For.
  app.set('trust proxy', 'loopback');
  app.use(express.json());
  app.post('/test', chatLimiter, (req, res) => {
    res.json({ success: true });
  });
  return app;
}

describe('rateLimiter (chatLimiter)', () => {
  let app: express.Express;

  beforeEach(async () => {
    // Fake timers BEFORE creating the limiter: the MemoryStore uses setInterval and
    // Date.now(), and both come under test control (60s window).
    vi.useFakeTimers();
    await loadFreshLimiter();
    app = createTestApp();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('requests within limit', () => {
    it('should allow requests under the limit', async () => {
      const promises = Array(5).fill(null).map(() => request(app).post('/test'));
      const responses = await Promise.all(promises);
      
      for (const res of responses) {
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
      }
    });

    it('should include rate limit headers', async () => {
      const res = await request(app).post('/test');
      
      expect(res.headers).toHaveProperty('ratelimit-limit');
      expect(res.headers).toHaveProperty('ratelimit-remaining');
      expect(res.headers).toHaveProperty('ratelimit-reset');
    });

    it('should decrement remaining count', async () => {
      const res1 = await request(app).post('/test');
      const res2 = await request(app).post('/test');
      
      const remaining1 = parseInt(res1.headers['ratelimit-remaining'], 10);
      const remaining2 = parseInt(res2.headers['ratelimit-remaining'], 10);
      
      expect(remaining2).toBe(remaining1 - 1);
    });
  });

  describe('requests exceeding limit', () => {
    it('should block requests over the limit', async () => {
      // Make 5 allowed requests
      for (let i = 0; i < 5; i++) {
        const res = await request(app).post('/test');
        expect(res.status).toBe(200);
      }
      
      // 6th request should be blocked
      const res = await request(app).post('/test');
      expect(res.status).toBe(429);
      expect(res.body.error).toContain('Muitas requisições');
    });

    it('should return proper error message', async () => {
      for (let i = 0; i < 5; i++) {
        await request(app).post('/test');
      }
      
      const res = await request(app).post('/test');
      expect(res.status).toBe(429);
      expect(res.body).toHaveProperty('error');
      expect(typeof res.body.error).toBe('string');
    });

    it('should have retry-after header on 429', async () => {
      for (let i = 0; i < 5; i++) {
        await request(app).post('/test');
      }
      
      const res = await request(app).post('/test');
      expect(res.headers).toHaveProperty('retry-after');
    });
  });

  describe('window reset', () => {
    it('should allow requests after window expires', async () => {
      // Make 5 requests
      for (let i = 0; i < 5; i++) {
        const res = await request(app).post('/test');
        expect(res.status).toBe(200);
      }
      
      // 6th should be blocked
      let res = await request(app).post('/test');
      expect(res.status).toBe(429);
      
      // Advance time past the window (60 seconds)
      vi.advanceTimersByTime(61 * 1000);
      
      // Should be allowed again
      res = await request(app).post('/test');
      expect(res.status).toBe(200);
    });

    it('should reset remaining count after window', async () => {
      for (let i = 0; i < 3; i++) {
        await request(app).post('/test');
      }
      
      vi.advanceTimersByTime(61 * 1000);
      
      const res = await request(app).post('/test');
      const remaining = parseInt(res.headers['ratelimit-remaining'], 10);
      expect(remaining).toBe(4); // 5 - 1 = 4
    });
  });

  describe('IP isolation', () => {
    it('should track limits per IP', async () => {
      const app1 = createTestApp();
      const app2 = createTestApp();
      
      // Use different IPs by setting X-Forwarded-For
      for (let i = 0; i < 5; i++) {
        const res = await request(app1).post('/test').set('X-Forwarded-For', '192.168.1.1');
        expect(res.status).toBe(200);
      }
      
      // Same IP should be blocked
      let res = await request(app1).post('/test').set('X-Forwarded-For', '192.168.1.1');
      expect(res.status).toBe(429);
      
      // Different IP should still work
      res = await request(app1).post('/test').set('X-Forwarded-For', '192.168.1.2');
      expect(res.status).toBe(200);
    });
  });

  describe('configuration verification', () => {
    it('should have windowMs of 60 seconds', async () => {
      const res = await request(app).post('/test');
      const resetSeconds = parseInt(res.headers['ratelimit-reset'], 10);

      // RateLimit-Reset (standardHeaders/draft-6) reports seconds until the
      // window resets (a delta), not an epoch timestamp.
      expect(resetSeconds).toBeGreaterThanOrEqual(55);
      expect(resetSeconds).toBeLessThanOrEqual(65);
    });

    it('should have max of 5 requests', async () => {
      const res = await request(app).post('/test');
      const limit = parseInt(res.headers['ratelimit-limit'], 10);
      expect(limit).toBe(5);
    });

    it('should use standard headers', async () => {
      const res = await request(app).post('/test');
      expect(res.headers).toHaveProperty('ratelimit-limit');
      expect(res.headers).toHaveProperty('ratelimit-remaining');
      expect(res.headers).toHaveProperty('ratelimit-reset');
      // legacyHeaders: false means no X-RateLimit-* headers
      expect(res.headers).not.toHaveProperty('x-ratelimit-limit');
    });
  });

  describe('test isolation', () => {
    it('should not share state between test runs (distinct limiter instances)', async () => {
      // Exhaust the limit on appA (the limiter instance loaded in beforeEach)
      for (let i = 0; i < 5; i++) {
        const res = await request(app).post('/test');
        expect(res.status).toBe(200);
      }
      const blocked = await request(app).post('/test');
      expect(blocked.status).toBe(429);

      // A new limiter instance (module reloaded) in another app does not
      // inherit the counters: state is per instance, not global.
      await loadFreshLimiter();
      const appB = createTestApp();
      const res = await request(appB).post('/test');
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });
  });
});

describe('rateLimiter integration concerns', () => {
  beforeEach(async () => {
    await loadFreshLimiter();
  });

  it('should not affect other middleware when applied to specific route', async () => {
    const app = express();
    app.use(express.json());
    
    // Apply limiter only to /chat
    app.post('/chat', chatLimiter, (req, res) => res.json({ ok: true }));
    app.post('/other', (req, res) => res.json({ ok: true }));
    
    // Exhaust /chat limit
    for (let i = 0; i < 5; i++) {
      await request(app).post('/chat');
    }
    
    // /other should still work
    const res = await request(app).post('/other');
    expect(res.status).toBe(200);
  });
});