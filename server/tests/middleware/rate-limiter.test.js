const request = require('supertest');
const express = require('express');
const {
  DEFAULT_LIMIT_CODE,
  DEFAULT_LIMIT_MESSAGE,
  parsePositiveInteger,
  createRateLimitResponse,
  createRateLimiter
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
});
