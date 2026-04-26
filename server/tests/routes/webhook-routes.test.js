const request = require('supertest');
const express = require('express');
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

const TEST_PUBLIC_KEY = 'GDZYF2MVD4MMJIDNVTVCKRWP7F55N56CGKUCLH7SZ7KJQLGMMFMNVOVP';

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri());

  process.env.JWT_SECRET = 'test-secret-key-for-testing-only';
  process.env.JWT_EXPIRES_IN = '1h';

  app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.correlationId = 'test-id'; next(); });
  app.use('/api', webhookRoutes);
  app.use(errorHandler);

  testUser = await User.create({ publicKey: TEST_PUBLIC_KEY, username: 'tester' });
  validToken = generateToken(TEST_PUBLIC_KEY, 'tester');
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

beforeEach(async () => {
  await Webhook.deleteMany({});
});

describe('POST /api/webhooks', () => {
  it('registers a webhook', async () => {
    const res = await request(app)
      .post('/api/webhooks')
      .set('Authorization', `Bearer ${validToken}`)
      .send({ url: 'https://example.com/hook', secret: 'supersecretvalue1234', events: ['token.minted'] });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.url).toBe('https://example.com/hook');
  });

  it('rejects invalid URL', async () => {
    const res = await request(app)
      .post('/api/webhooks')
      .set('Authorization', `Bearer ${validToken}`)
      .send({ url: 'not-a-url', secret: 'supersecretvalue1234', events: ['token.minted'] });

    expect(res.status).toBe(400);
  });

  it('rejects short secret', async () => {
    const res = await request(app)
      .post('/api/webhooks')
      .set('Authorization', `Bearer ${validToken}`)
      .send({ url: 'https://example.com/hook', secret: 'short', events: ['token.minted'] });

    expect(res.status).toBe(400);
  });

  it('requires authentication', async () => {
    const res = await request(app)
      .post('/api/webhooks')
      .send({ url: 'https://example.com/hook', secret: 'supersecretvalue1234' });

    expect(res.status).toBe(401);
  });
});

describe('GET /api/webhooks', () => {
  it('lists webhooks for authenticated user', async () => {
    await Webhook.create({
      ownerPublicKey: TEST_PUBLIC_KEY,
      url: 'https://example.com/hook',
      secret: 'supersecretvalue1234',
      events: ['token.minted'],
    });

    const res = await request(app)
      .get('/api/webhooks')
      .set('Authorization', `Bearer ${validToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].secret).toBeUndefined();
  });

  it('returns empty array when no webhooks', async () => {
    const res = await request(app)
      .get('/api/webhooks')
      .set('Authorization', `Bearer ${validToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(0);
  });
});

describe('DELETE /api/webhooks/:id', () => {
  it('deletes own webhook', async () => {
    const wh = await Webhook.create({
      ownerPublicKey: TEST_PUBLIC_KEY,
      url: 'https://example.com/hook',
      secret: 'supersecretvalue1234',
      events: ['token.minted'],
    });

    const res = await request(app)
      .delete(`/api/webhooks/${wh._id}`)
      .set('Authorization', `Bearer ${validToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(await Webhook.findById(wh._id)).toBeNull();
  });

  it('returns 404 for non-existent webhook', async () => {
    const fakeId = new mongoose.Types.ObjectId();
    const res = await request(app)
      .delete(`/api/webhooks/${fakeId}`)
      .set('Authorization', `Bearer ${validToken}`);

    expect(res.status).toBe(404);
  });
});
