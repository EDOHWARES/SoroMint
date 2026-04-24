const request = require('supertest');
const express = require('express');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const User = require('../../models/User');
const ApiKey = require('../../models/ApiKey');
const ApiUsage = require('../../models/ApiUsage');
const { generateToken } = require('../../middleware/auth');
const { errorHandler } = require('../../middleware/error-handler');
const apiKeyRoutes = require('../../routes/api-key-routes');

const TEST_PUBLIC_KEY =
  'GDZYF2MVD4MMJIDNVTVCKRWP7F55N56CGKUCLH7SZ7KJQLGMMFMNVOVP';
const OTHER_PUBLIC_KEY =
  'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAB';

let mongoServer;
let app;
let validToken;

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri());

  process.env.JWT_SECRET = 'test-secret-key-for-api-key-tests';
  process.env.JWT_EXPIRES_IN = '1h';

  await User.create({ publicKey: TEST_PUBLIC_KEY, username: 'devuser' });
  validToken = generateToken(TEST_PUBLIC_KEY, 'devuser');

  app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.correlationId = 'test-id';
    next();
  });
  app.use('/api/api-keys', apiKeyRoutes);
  app.use(errorHandler);
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

beforeEach(async () => {
  await ApiKey.deleteMany({});
  await ApiUsage.deleteMany({});
});

describe('POST /api/api-keys', () => {
  it('creates an API key and returns plaintext exactly once', async () => {
    const res = await request(app)
      .post('/api/api-keys')
      .set('Authorization', `Bearer ${validToken}`)
      .send({
        name: 'my-key',
        tier: 'pro',
        scopes: ['tokens:read', 'tokens:write'],
      });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.key).toMatch(/^sm_/);
    expect(res.body.data.prefix).toBe(res.body.data.key.slice(0, 11));
    expect(res.body.data.tier).toBe('pro');
    expect(res.body.data.scopes).toEqual(
      expect.arrayContaining(['tokens:read', 'tokens:write'])
    );

    const stored = await ApiKey.findById(res.body.data.id);
    expect(stored).not.toBeNull();
    expect(stored.keyHash).toBe(ApiKey.hashKey(res.body.data.key));
  });

  it('rejects invalid scopes', async () => {
    const res = await request(app)
      .post('/api/api-keys')
      .set('Authorization', `Bearer ${validToken}`)
      .send({ name: 'bad', scopes: ['nope'] });

    expect(res.status).toBe(400);
  });

  it('requires authentication', async () => {
    const res = await request(app)
      .post('/api/api-keys')
      .send({ name: 'my-key' });

    expect(res.status).toBe(401);
  });
});

describe('GET /api/api-keys', () => {
  it('lists only the caller keys and omits secrets', async () => {
    await ApiKey.create({
      ownerPublicKey: TEST_PUBLIC_KEY,
      name: 'mine',
      prefix: 'sm_abc12345',
      keyHash: ApiKey.hashKey('sm_mine_plain_value_1234567890'),
    });
    await ApiKey.create({
      ownerPublicKey: OTHER_PUBLIC_KEY,
      name: 'someone-else',
      prefix: 'sm_xyz12345',
      keyHash: ApiKey.hashKey('sm_other_plain_value_1234567890'),
    });

    const res = await request(app)
      .get('/api/api-keys')
      .set('Authorization', `Bearer ${validToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].name).toBe('mine');
    expect(res.body.data[0].keyHash).toBeUndefined();
  });
});

describe('POST /api/api-keys/:id/rotate', () => {
  it('rotates the key and returns a new plaintext', async () => {
    const originalPlain = ApiKey.generatePlaintext();
    const key = await ApiKey.create({
      ownerPublicKey: TEST_PUBLIC_KEY,
      name: 'rotate-me',
      prefix: ApiKey.derivePrefix(originalPlain),
      keyHash: ApiKey.hashKey(originalPlain),
    });

    const res = await request(app)
      .post(`/api/api-keys/${key._id}/rotate`)
      .set('Authorization', `Bearer ${validToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.key).toMatch(/^sm_/);

    const refreshed = await ApiKey.findById(key._id);
    expect(refreshed.keyHash).toBe(ApiKey.hashKey(res.body.data.key));
    expect(refreshed.keyHash).not.toBe(ApiKey.hashKey(originalPlain));
  });
});

describe('POST /api/api-keys/:id/revoke', () => {
  it('marks the key as revoked', async () => {
    const plain = ApiKey.generatePlaintext();
    const key = await ApiKey.create({
      ownerPublicKey: TEST_PUBLIC_KEY,
      name: 'revoke-me',
      prefix: ApiKey.derivePrefix(plain),
      keyHash: ApiKey.hashKey(plain),
    });

    const res = await request(app)
      .post(`/api/api-keys/${key._id}/revoke`)
      .set('Authorization', `Bearer ${validToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('revoked');

    const refreshed = await ApiKey.findById(key._id);
    expect(refreshed.status).toBe('revoked');
  });
});

describe('DELETE /api/api-keys/:id', () => {
  it('deletes the key and its usage records', async () => {
    const plain = ApiKey.generatePlaintext();
    const key = await ApiKey.create({
      ownerPublicKey: TEST_PUBLIC_KEY,
      name: 'doomed',
      prefix: ApiKey.derivePrefix(plain),
      keyHash: ApiKey.hashKey(plain),
    });
    await ApiUsage.create({
      apiKeyId: key._id,
      ownerPublicKey: TEST_PUBLIC_KEY,
      method: 'GET',
      path: '/api/v1/developer/tokens',
      statusCode: 200,
    });

    const res = await request(app)
      .delete(`/api/api-keys/${key._id}`)
      .set('Authorization', `Bearer ${validToken}`);

    expect(res.status).toBe(200);
    expect(await ApiKey.findById(key._id)).toBeNull();
    expect(await ApiUsage.countDocuments({ apiKeyId: key._id })).toBe(0);
  });

  it('returns 404 when the key does not belong to caller', async () => {
    const plain = ApiKey.generatePlaintext();
    const key = await ApiKey.create({
      ownerPublicKey: OTHER_PUBLIC_KEY,
      name: 'not-mine',
      prefix: ApiKey.derivePrefix(plain),
      keyHash: ApiKey.hashKey(plain),
    });

    const res = await request(app)
      .delete(`/api/api-keys/${key._id}`)
      .set('Authorization', `Bearer ${validToken}`);

    expect(res.status).toBe(404);
  });
});

describe('GET /api/api-keys/:id/usage', () => {
  it('aggregates usage for the key', async () => {
    const plain = ApiKey.generatePlaintext();
    const key = await ApiKey.create({
      ownerPublicKey: TEST_PUBLIC_KEY,
      name: 'stats',
      prefix: ApiKey.derivePrefix(plain),
      keyHash: ApiKey.hashKey(plain),
    });

    await ApiUsage.create([
      {
        apiKeyId: key._id,
        ownerPublicKey: TEST_PUBLIC_KEY,
        method: 'GET',
        path: '/api/v1/developer/tokens',
        statusCode: 200,
        durationMs: 10,
      },
      {
        apiKeyId: key._id,
        ownerPublicKey: TEST_PUBLIC_KEY,
        method: 'GET',
        path: '/api/v1/developer/tokens',
        statusCode: 200,
        durationMs: 20,
      },
      {
        apiKeyId: key._id,
        ownerPublicKey: TEST_PUBLIC_KEY,
        method: 'GET',
        path: '/api/v1/developer/health',
        statusCode: 429,
        durationMs: 5,
      },
    ]);

    const res = await request(app)
      .get(`/api/api-keys/${key._id}/usage`)
      .set('Authorization', `Bearer ${validToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.totalRequests).toBe(3);
    expect(res.body.data.byStatus).toEqual(
      expect.arrayContaining([
        { statusCode: 200, count: 2 },
        { statusCode: 429, count: 1 },
      ])
    );
    expect(res.body.data.topEndpoints[0].count).toBeGreaterThanOrEqual(1);
  });
});
