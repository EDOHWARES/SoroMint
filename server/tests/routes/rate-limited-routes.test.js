const request = require('supertest');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const User = require('../../models/User');
const { generateToken } = require('../../middleware/auth');
const { createRateLimiter } = require('../../middleware/rate-limiter');
const { createAuthRouter } = require('../../routes/auth-routes');
const { createTokenRouter } = require('../../routes/token-routes');

const TEST_PUBLIC_KEY = 'GDZYF2MVD4MMJIDNVTVCKRWP7F55N56CGKUCLH7SZ7KJQLGMMFMNVOVP';
const TEST_CONTRACT_ID = 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

let mongoServer;
let testUser;
let validToken;
let createApp;

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri());

  process.env.MONGO_URI = mongoServer.getUri();
  process.env.JWT_SECRET = 'test-secret-key-for-rate-limit-tests';
  process.env.JWT_EXPIRES_IN = '1h';
  process.env.SOROBAN_RPC_URL = 'https://soroban-testnet.stellar.org';

  ({ createApp } = require('../../index'));

  testUser = await User.create({
    publicKey: TEST_PUBLIC_KEY,
    username: 'ratelimituser'
  });

  validToken = generateToken(TEST_PUBLIC_KEY, 'ratelimituser');
});

afterEach(async () => {
  await mongoose.connection.db.dropDatabase();

  testUser = await User.create({
    publicKey: TEST_PUBLIC_KEY,
    username: 'ratelimituser'
  });

  validToken = generateToken(TEST_PUBLIC_KEY, 'ratelimituser');
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
  delete process.env.MONGO_URI;
  delete process.env.JWT_SECRET;
  delete process.env.JWT_EXPIRES_IN;
  delete process.env.SOROBAN_RPC_URL;
});

describe('Rate Limited Routes', () => {
  it('should rate limit login attempts with the standard error response', async () => {
    const limitedApp = createApp({
      authRouter: createAuthRouter({
        authLoginRateLimiter: createRateLimiter({ windowMs: 60_000, max: 1 })
      })
    });

    const firstResponse = await request(limitedApp)
      .post('/api/auth/login')
      .send({ publicKey: TEST_PUBLIC_KEY });

    const secondResponse = await request(limitedApp)
      .post('/api/auth/login')
      .send({ publicKey: TEST_PUBLIC_KEY });

    expect(firstResponse.status).toBe(200);
    expect(secondResponse.status).toBe(429);
    expect(secondResponse.body).toEqual({
      error: 'Too many requests. Please try again later.',
      code: 'RATE_LIMIT_EXCEEDED',
      status: 429
    });
  });

  it('should rate limit token deployment requests with the standard error response', async () => {
    const app = createApp({
      tokenRouter: createTokenRouter({
        deployRateLimiter: createRateLimiter({ windowMs: 60_000, max: 1 })
      })
    });

    const firstResponse = await request(app)
      .post('/api/tokens')
      .set('Authorization', `Bearer ${validToken}`)
      .send({
        name: 'Limited Token',
        symbol: 'LIM',
        contractId: TEST_CONTRACT_ID,
        ownerPublicKey: TEST_PUBLIC_KEY
      });

    const secondResponse = await request(app)
      .post('/api/tokens')
      .set('Authorization', `Bearer ${validToken}`)
      .send({
        name: 'Blocked Token',
        symbol: 'BLK',
        contractId: `C${'B'.repeat(55)}`,
        ownerPublicKey: TEST_PUBLIC_KEY
      });

    expect(firstResponse.status).toBe(201);
    expect(secondResponse.status).toBe(429);
    expect(secondResponse.body).toEqual({
      error: 'Too many requests. Please try again later.',
      code: 'RATE_LIMIT_EXCEEDED',
      status: 429
    });
  });
});
