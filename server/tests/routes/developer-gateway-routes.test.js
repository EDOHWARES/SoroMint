const request = require('supertest');
const express = require('express');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const ApiKey = require('../../models/ApiKey');
const ApiUsage = require('../../models/ApiUsage');
const Token = require('../../models/Token');
const { errorHandler } = require('../../middleware/error-handler');
const { resetRateLimitBuckets } = require('../../middleware/api-key-auth');
const developerGatewayRoutes = require('../../routes/developer-gateway-routes');

const TEST_PUBLIC_KEY =
  'GDZYF2MVD4MMJIDNVTVCKRWP7F55N56CGKUCLH7SZ7KJQLGMMFMNVOVP';
const OTHER_PUBLIC_KEY =
  'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAB';

let mongoServer;
let app;

const createKey = async (overrides = {}) => {
  const plain = ApiKey.generatePlaintext();
  const doc = await ApiKey.create({
    ownerPublicKey: TEST_PUBLIC_KEY,
    name: 'dev',
    prefix: ApiKey.derivePrefix(plain),
    keyHash: ApiKey.hashKey(plain),
    scopes: ['tokens:read', 'tokens:write'],
    tier: 'pro',
    ...overrides,
  });
  return { doc, plain };
};

const flushUsage = async () => {
  // Usage is recorded on res 'finish' which fires after supertest resolves,
  // but the insertion is async; give the event loop a tick.
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setTimeout(resolve, 50));
};

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri());

  app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.correlationId = 'test-id';
    next();
  });
  app.use('/api/v1/developer', developerGatewayRoutes);
  app.use(errorHandler);
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

beforeEach(async () => {
  await ApiKey.deleteMany({});
  await ApiUsage.deleteMany({});
  await Token.deleteMany({});
  resetRateLimitBuckets();
});

describe('Developer API Gateway authentication', () => {
  it('rejects requests without an API key', async () => {
    const res = await request(app).get('/api/v1/developer/health');
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('API_KEY_REQUIRED');
  });

  it('rejects invalid API keys', async () => {
    const res = await request(app)
      .get('/api/v1/developer/health')
      .set('X-API-Key', 'sm_totally_bogus_value');

    expect(res.status).toBe(401);
    expect(res.body.code).toBe('INVALID_API_KEY');
  });

  it('rejects revoked API keys', async () => {
    const { plain } = await createKey({ status: 'revoked' });

    const res = await request(app)
      .get('/api/v1/developer/health')
      .set('X-API-Key', plain);

    expect(res.status).toBe(401);
    expect(res.body.code).toBe('API_KEY_REVOKED');
  });

  it('rejects expired API keys', async () => {
    const { plain } = await createKey({
      expiresAt: new Date(Date.now() - 1000),
    });

    const res = await request(app)
      .get('/api/v1/developer/health')
      .set('X-API-Key', plain);

    expect(res.status).toBe(401);
    expect(res.body.code).toBe('API_KEY_EXPIRED');
  });

  it('accepts API keys via Authorization: ApiKey <value>', async () => {
    const { plain } = await createKey();

    const res = await request(app)
      .get('/api/v1/developer/health')
      .set('Authorization', `ApiKey ${plain}`);

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('ok');
  });

  it('enforces required scopes', async () => {
    const { plain } = await createKey({ scopes: ['tokens:read'] });

    const res = await request(app)
      .post('/api/v1/developer/tokens')
      .set('X-API-Key', plain)
      .send({
        name: 'Scoped Token',
        symbol: 'SCP',
        contractId: `C${'A'.repeat(55)}`,
      });

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('INSUFFICIENT_SCOPE');
  });
});

describe('Developer API Gateway rate limiting', () => {
  it('returns 429 once the per-key limit is exceeded', async () => {
    const { plain } = await createKey({
      rateLimit: { windowMs: 60_000, max: 2 },
    });

    const first = await request(app)
      .get('/api/v1/developer/health')
      .set('X-API-Key', plain);
    const second = await request(app)
      .get('/api/v1/developer/health')
      .set('X-API-Key', plain);
    const third = await request(app)
      .get('/api/v1/developer/health')
      .set('X-API-Key', plain);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(third.status).toBe(429);
    expect(third.body.code).toBe('RATE_LIMIT_EXCEEDED');
    expect(third.headers['x-ratelimit-limit']).toBe('2');
    expect(third.headers['x-ratelimit-remaining']).toBe('0');
    expect(third.headers['retry-after']).toBeDefined();
  });

  it('exposes rate-limit headers on successful responses', async () => {
    const { plain } = await createKey({
      rateLimit: { windowMs: 60_000, max: 5 },
    });

    const res = await request(app)
      .get('/api/v1/developer/health')
      .set('X-API-Key', plain);

    expect(res.status).toBe(200);
    expect(res.headers['x-ratelimit-limit']).toBe('5');
    expect(res.headers['x-ratelimit-remaining']).toBe('4');
  });
});

describe('Developer API Gateway token endpoints', () => {
  it('scopes list results to the key owner', async () => {
    const { plain } = await createKey();

    await Token.create({
      name: 'Mine',
      symbol: 'MIN',
      contractId: `C${'A'.repeat(55)}`,
      ownerPublicKey: TEST_PUBLIC_KEY,
    });
    await Token.create({
      name: 'NotMine',
      symbol: 'NOT',
      contractId: `C${'B'.repeat(55)}`,
      ownerPublicKey: OTHER_PUBLIC_KEY,
    });

    const res = await request(app)
      .get('/api/v1/developer/tokens')
      .set('X-API-Key', plain);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].symbol).toBe('MIN');
    expect(res.body.metadata.totalCount).toBe(1);
  });

  it('creates a token when the key has tokens:write', async () => {
    const { plain } = await createKey();

    const res = await request(app)
      .post('/api/v1/developer/tokens')
      .set('X-API-Key', plain)
      .send({
        name: 'Created Via API',
        symbol: 'CVA',
        contractId: `C${'C'.repeat(55)}`,
        decimals: 7,
      });

    expect(res.status).toBe(201);
    expect(res.body.data.ownerPublicKey).toBe(TEST_PUBLIC_KEY);
  });
});

describe('Developer API Gateway usage tracking', () => {
  it('records usage after a successful request', async () => {
    const { doc, plain } = await createKey();

    await request(app).get('/api/v1/developer/health').set('X-API-Key', plain);

    await flushUsage();

    const usage = await ApiUsage.find({ apiKeyId: doc._id });
    expect(usage.length).toBe(1);
    expect(usage[0].method).toBe('GET');
    expect(usage[0].statusCode).toBe(200);

    const refreshed = await ApiKey.findById(doc._id);
    expect(refreshed.usageCount).toBe(1);
    expect(refreshed.lastUsedAt).toBeInstanceOf(Date);
  });
});
