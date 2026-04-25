const request = require('supertest');
const express = require('express');
const {
  DEFAULT_LIMIT_CODE,
  DEFAULT_LIMIT_MESSAGE,
  parsePositiveInteger,
  createRateLimitResponse,
  createRateLimiter,
  createGlobalReadRateLimiter,
  createGlobalWriteRateLimiter,
} = require('../../middleware/rate-limiter');

describe('Rate Limiter Middleware', () => {
  it('should return parsed positive integers', () => {
    expect(parsePositiveInteger('12', 5)).toBe(12);
  });

  it('should fall back for invalid or non-positive integers', () => {
    expect(parsePositiveInteger('not-a-number', 5)).toBe(5);
    expect(parsePositiveInteger('0', 5)).toBe(5);
    expect(parsePositiveInteger('-3', 5)).toBe(5);
  });

  it('should build the shared rate limit response payload', () => {
    expect(createRateLimitResponse()).toEqual({
      error: DEFAULT_LIMIT_MESSAGE,
      code: DEFAULT_LIMIT_CODE,
      status: 429
    });
  });

  it('should reject requests after the configured threshold', async () => {
    const app = express();
    app.use(express.json());
    app.post('/limited', createRateLimiter({ windowMs: 60_000, max: 1 }), (req, res) => {
      res.status(201).json({ success: true });
    });

    const firstResponse = await request(app)
      .post('/limited')
      .send({ ok: true });

    const secondResponse = await request(app)
      .post('/limited')
      .send({ ok: true });

    expect(firstResponse.status).toBe(201);
    expect(secondResponse.status).toBe(429);
    expect(secondResponse.body).toEqual({
      error: DEFAULT_LIMIT_MESSAGE,
      code: DEFAULT_LIMIT_CODE,
      status: 429
    });
  });

  describe('Global Read Rate Limiter', () => {
    it('should allow GET requests within limit', async () => {
      const app = express();
      app.use(express.json());
      app.use(createGlobalReadRateLimiter());
      app.get('/test', (req, res) => res.json({ ok: true }));

      const response = await request(app).get('/test');
      expect(response.status).toBe(200);
      expect(response.body).toEqual({ ok: true });
    });

    it('should skip rate limiting for non-GET requests', async () => {
      const app = express();
      app.use(express.json());
      app.use(createGlobalReadRateLimiter());
      app.post('/test', (req, res) => res.json({ ok: true }));

      for (let i = 0; i < 10; i++) {
        const response = await request(app).post('/test').send({ ok: true });
        expect(response.status).toBe(200);
      }
    });

    it('should reject GET requests after threshold', async () => {
      const app = express();
      app.use(express.json());
      app.use(createGlobalReadRateLimiter({ windowMs: 60_000, max: 2 }));
      app.get('/test', (req, res) => res.json({ ok: true }));

      await request(app).get('/test');
      await request(app).get('/test');
      const rejected = await request(app).get('/test');

      expect(rejected.status).toBe(429);
      expect(rejected.body).toEqual({
        error: DEFAULT_LIMIT_MESSAGE,
        code: DEFAULT_LIMIT_CODE,
        status: 429
      });
    });

    it('should return standard rate limit headers', async () => {
      const app = express();
      app.use(express.json());
      app.use(createGlobalReadRateLimiter({ windowMs: 60_000, max: 1 }));
      app.get('/test', (req, res) => res.json({ ok: true }));

      const response = await request(app).get('/test');
      expect(response.headers['ratelimit-limit']).toBeDefined();
      expect(response.headers['ratelimit-remaining']).toBeDefined();
      expect(response.headers['ratelimit-reset']).toBeDefined();
    });
  });

  describe('Global Write Rate Limiter', () => {
    it('should skip rate limiting for GET requests', async () => {
      const app = express();
      app.use(express.json());
      app.use(createGlobalWriteRateLimiter());
      app.get('/test', (req, res) => res.json({ ok: true }));

      for (let i = 0; i < 50; i++) {
        const response = await request(app).get('/test');
        expect(response.status).toBe(200);
      }
    });

    it('should allow POST requests within limit', async () => {
      const app = express();
      app.use(express.json());
      app.use(createGlobalWriteRateLimiter());
      app.post('/test', (req, res) => res.json({ ok: true }));

      const response = await request(app).post('/test').send({ ok: true });
      expect(response.status).toBe(200);
      expect(response.body).toEqual({ ok: true });
    });

    it('should reject POST requests after threshold', async () => {
      const app = express();
      app.use(express.json());
      app.use(createGlobalWriteRateLimiter({ windowMs: 60_000, max: 2 }));
      app.post('/test', (req, res) => res.json({ ok: true }));

      await request(app).post('/test').send({ ok: true });
      await request(app).post('/test').send({ ok: true });
      const rejected = await request(app).post('/test').send({ ok: true });

      expect(rejected.status).toBe(429);
      expect(rejected.body).toEqual({
        error: DEFAULT_LIMIT_MESSAGE,
        code: DEFAULT_LIMIT_CODE,
        status: 429
      });
    });

    it('should reject DELETE requests after threshold', async () => {
      const app = express();
      app.use(express.json());
      app.use(createGlobalWriteRateLimiter({ windowMs: 60_000, max: 1 }));
      app.delete('/test/:id', (req, res) => res.json({ ok: true }));

      await request(app).delete('/test/1');
      const rejected = await request(app).delete('/test/2');

      expect(rejected.status).toBe(429);
      expect(rejected.body).toEqual({
        error: DEFAULT_LIMIT_MESSAGE,
        code: DEFAULT_LIMIT_CODE,
        status: 429
      });
    });
  });
});
