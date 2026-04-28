const request = require('supertest');
const express = require('express');

jest.mock('../../middleware/auth', () => ({
  authenticate: (req, _res, next) => {
    req.user = {
      publicKey: 'GDZYF2MVD4MMJIDNVTVCKRWP7F55N56CGKUCLH7SZ7KJQLGMMFMNVOVP',
    };
    next();
  },
  generateToken: jest.fn(),
}));

jest.mock('../../models/Webhook', () => ({
  create: jest.fn(),
  find: jest.fn(),
  findOneAndDelete: jest.fn(),
}));

const Webhook = require('../../models/Webhook');
const webhookRoutes = require('../../routes/webhook-routes');
const { errorHandler } = require('../../middleware/error-handler');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const User = require('../../models/User');
const Webhook = require('../../models/Webhook');
const { generateToken } = require('../../middleware/auth');
const { errorHandler } = require('../../middleware/error-handler');
const webhookRoutes = require('../../routes/webhook-routes');

let mongoServer;
let app;
let validToken;
let testUser;

const TEST_PUBLIC_KEY =
  'GDZYF2MVD4MMJIDNVTVCKRWP7F55N56CGKUCLH7SZ7KJQLGMMFMNVOVP';

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri());

  process.env.JWT_SECRET = 'test-secret-key-for-testing-only';
  process.env.JWT_EXPIRES_IN = '1h';

  app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.correlationId = 'test-id';
    next();
  });
  app.use('/api', webhookRoutes);
  app.use(errorHandler);

  testUser = await User.create({
    publicKey: TEST_PUBLIC_KEY,
    username: 'tester',
  });
  validToken = generateToken(TEST_PUBLIC_KEY, 'tester');
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

describe('webhook routes', () => {
  let app;

  beforeEach(() => {
    jest.clearAllMocks();
describe('POST /api/webhooks', () => {
  it('registers a webhook', async () => {
    const res = await request(app)
      .post('/api/webhooks')
      .set('Authorization', `Bearer ${validToken}`)
      .send({
        url: 'https://example.com/hook',
        secret: 'supersecretvalue1234',
        events: ['token.minted'],
      });

    app = express();
    app.use(express.json());
    app.use('/api', webhookRoutes);
    app.use(errorHandler);
  });

  describe('POST /api/webhooks', () => {
    it('registers a webhook', async () => {
      Webhook.create.mockResolvedValue({
        _id: 'webhook-1',
        url: 'https://example.com/hook',
        secret: 'supersecretvalue1234',
        events: ['token.minted'],
      });

      const res = await request(app)
        .post('/api/webhooks')
        .send({
          url: 'https://example.com/hook',
          secret: 'supersecretvalue1234',
          events: ['token.minted'],
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.url).toBe('https://example.com/hook');
      expect(Webhook.create).toHaveBeenCalledWith(
        expect.objectContaining({
          ownerPublicKey:
            'GDZYF2MVD4MMJIDNVTVCKRWP7F55N56CGKUCLH7SZ7KJQLGMMFMNVOVP',
        })
      );
    });
  it('rejects invalid URL', async () => {
    const res = await request(app)
      .post('/api/webhooks')
      .set('Authorization', `Bearer ${validToken}`)
      .send({
        url: 'not-a-url',
        secret: 'supersecretvalue1234',
        events: ['token.minted'],
      });

    it('registers a stream webhook', async () => {
      Webhook.create.mockResolvedValue({
        _id: 'webhook-2',
        url: 'https://example.com/stream-hook',
        secret: 'supersecretvalue1234',
        events: ['stream.created', 'stream.withdrawn'],
      });

      const res = await request(app)
        .post('/api/webhooks')
        .send({
          url: 'https://example.com/stream-hook',
          secret: 'supersecretvalue1234',
          events: ['stream.created', 'stream.withdrawn'],
        });

      expect(res.status).toBe(201);
      expect(res.body.data.events).toEqual(
        expect.arrayContaining(['stream.created', 'stream.withdrawn'])
      );
    });

    it('rejects invalid URL', async () => {
      const res = await request(app)
        .post('/api/webhooks')
        .send({
          url: 'not-a-url',
          secret: 'supersecretvalue1234',
          events: ['token.minted'],
        });
  it('rejects short secret', async () => {
    const res = await request(app)
      .post('/api/webhooks')
      .set('Authorization', `Bearer ${validToken}`)
      .send({
        url: 'https://example.com/hook',
        secret: 'short',
        events: ['token.minted'],
      });

      expect(res.status).toBe(400);
    });

    it('rejects short secret', async () => {
      const res = await request(app)
        .post('/api/webhooks')
        .send({
          url: 'https://example.com/hook',
          secret: 'short',
          events: ['token.minted'],
        });
  it('requires authentication', async () => {
    const res = await request(app)
      .post('/api/webhooks')
      .send({
        url: 'https://example.com/hook',
        secret: 'supersecretvalue1234',
      });

      expect(res.status).toBe(400);
    });
  });

  describe('GET /api/webhooks', () => {
    it('lists webhooks for authenticated user', async () => {
      Webhook.find.mockReturnValue({
        select: jest.fn().mockResolvedValue([
          {
            _id: 'webhook-1',
            url: 'https://example.com/hook',
            events: ['token.minted'],
          },
        ]),
      });

      const res = await request(app).get('/api/webhooks');

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].secret).toBeUndefined();
    });

    it('returns empty array when no webhooks', async () => {
      Webhook.find.mockReturnValue({
        select: jest.fn().mockResolvedValue([]),
      });

      const res = await request(app).get('/api/webhooks');

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(0);
    });
  });

  describe('DELETE /api/webhooks/:id', () => {
    it('deletes own webhook', async () => {
      Webhook.findOneAndDelete.mockResolvedValue({
        _id: 'webhook-1',
      });

      const res = await request(app).delete('/api/webhooks/webhook-1');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('returns 404 for non-existent webhook', async () => {
      Webhook.findOneAndDelete.mockResolvedValue(null);

      const res = await request(app).delete('/api/webhooks/fake-id');

      expect(res.status).toBe(404);
    });
  });
});
