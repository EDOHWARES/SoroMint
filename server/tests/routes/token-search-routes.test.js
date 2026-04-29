'use strict';

const request = require('supertest');
const express = require('express');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

// Mock cache-service before any route imports to avoid redis dependency
jest.mock('../../services/cache-service', () => ({
  getCacheService: () => ({
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue(undefined),
    delete: jest.fn().mockResolvedValue(undefined),
  }),
}));

const Token = require('../../models/Token');
const User = require('../../models/User');
const { generateToken } = require('../../middleware/auth');
const { errorHandler } = require('../../middleware/error-handler');
const tokenSearchRoutes = require('../../routes/token-search-routes');
const { _resetIndexCache } = require('../../services/token-search-service');

let mongoServer;
let app;
let authToken;

const OWNER = 'GDZYF2MVD4MMJIDNVTVCKRWP7F55N56CGKUCLH7SZ7KJQLGMMFMNVOVP';

const TOKENS = [
  {
    name: 'SoroMint Token',
    symbol: 'SORO',
    decimals: 7,
    contractId: 'C' + 'A'.repeat(55),
    ownerPublicKey: OWNER,
  },
  {
    name: 'SoroGold Asset',
    symbol: 'SGOLD',
    decimals: 7,
    contractId: 'C' + 'B'.repeat(55),
    ownerPublicKey: OWNER,
  },
  {
    name: 'Bitcoin Wrapped',
    symbol: 'BTC',
    decimals: 8,
    contractId: 'C' + 'C'.repeat(55),
    ownerPublicKey: OWNER,
  },
  {
    name: 'Ethereum Token',
    symbol: 'ETH',
    decimals: 18,
    contractId: 'C' + 'D'.repeat(55),
    ownerPublicKey: OWNER,
  },
  {
    name: 'Other Owner Token',
    symbol: 'OTH',
    decimals: 7,
    contractId: 'C' + 'E'.repeat(55),
    ownerPublicKey: 'G' + 'B'.repeat(55),
  },
];

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri());

  _resetIndexCache(); // ensure regex fallback (no Atlas Search in test env)

  app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.correlationId = 'test';
    next();
  });
  app.use('/api', tokenSearchRoutes);
  app.use(errorHandler);

  const user = await User.create({
    publicKey: OWNER,
    username: 'searcher',
    role: 'user',
  });
  authToken = generateToken(user);

  await Token.insertMany(TOKENS);
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

describe('GET /api/tokens/search', () => {
  it('returns all tokens when no filters given', async () => {
    const res = await request(app)
      .get('/api/tokens/search')
      .set('Authorization', `Bearer ${authToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.length).toBe(5);
    expect(res.body.metadata.total).toBe(5);
  });

  it('fuzzy-matches by name', async () => {
    const res = await request(app)
      .get('/api/tokens/search?q=soro')
      .set('Authorization', `Bearer ${authToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.length).toBe(2);
    expect(res.body.data.map((t) => t.symbol).sort()).toEqual([
      'SGOLD',
      'SORO',
    ]);
  });

  it('matches by symbol', async () => {
    const res = await request(app)
      .get('/api/tokens/search?q=BTC')
      .set('Authorization', `Bearer ${authToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].symbol).toBe('BTC');
  });

  it('filters by owner', async () => {
    const res = await request(app)
      .get(`/api/tokens/search?owner=${OWNER}`)
      .set('Authorization', `Bearer ${authToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.length).toBe(4);
    expect(res.body.data.every((t) => t.ownerPublicKey === OWNER)).toBe(true);
  });

  it('filters by decimals', async () => {
    const res = await request(app)
      .get('/api/tokens/search?decimals=8')
      .set('Authorization', `Bearer ${authToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].symbol).toBe('BTC');
  });

  it('combines q and owner filters', async () => {
    const res = await request(app)
      .get(`/api/tokens/search?q=token&owner=${OWNER}`)
      .set('Authorization', `Bearer ${authToken}`);

    expect(res.status).toBe(200);
    // "SoroMint Token" and "Ethereum Token" belong to OWNER; "Other Owner Token" does not
    expect(res.body.data.map((t) => t.symbol).sort()).toEqual(['ETH', 'SORO']);
  });

  it('paginates results', async () => {
    const res = await request(app)
      .get('/api/tokens/search?limit=2&page=2')
      .set('Authorization', `Bearer ${authToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
    expect(res.body.metadata.page).toBe(2);
    expect(res.body.metadata.totalPages).toBe(3);
  });

  it('returns empty data for unmatched query', async () => {
    const res = await request(app)
      .get('/api/tokens/search?q=zzznomatch')
      .set('Authorization', `Bearer ${authToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(0);
    expect(res.body.metadata.total).toBe(0);
  });

  it('returns suggestions alongside results', async () => {
    const res = await request(app)
      .get('/api/tokens/search?q=soro')
      .set('Authorization', `Bearer ${authToken}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.suggestions)).toBe(true);
    expect(res.body.suggestions.length).toBeGreaterThan(0);
  });

  it('rejects q longer than 100 chars', async () => {
    const res = await request(app)
      .get(`/api/tokens/search?q=${'a'.repeat(101)}`)
      .set('Authorization', `Bearer ${authToken}`);

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });

  it('rejects invalid owner key', async () => {
    const res = await request(app)
      .get('/api/tokens/search?owner=INVALID')
      .set('Authorization', `Bearer ${authToken}`);

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });

  it('rejects invalid page', async () => {
    const res = await request(app)
      .get('/api/tokens/search?page=0')
      .set('Authorization', `Bearer ${authToken}`);

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });

  it('requires authentication', async () => {
    const res = await request(app).get('/api/tokens/search');
    expect(res.status).toBe(401);
  });
});

describe('GET /api/tokens/suggest', () => {
  it('returns suggestions for a prefix', async () => {
    const res = await request(app)
      .get('/api/tokens/suggest?q=Soro')
      .set('Authorization', `Bearer ${authToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.suggestions.some((s) => /soro/i.test(s))).toBe(true);
  });

  it('returns empty array for empty q', async () => {
    const res = await request(app)
      .get('/api/tokens/suggest?q=')
      .set('Authorization', `Bearer ${authToken}`);

    expect(res.status).toBe(200);
    expect(res.body.suggestions).toEqual([]);
  });

  it('rejects q longer than 50 chars', async () => {
    const res = await request(app)
      .get(`/api/tokens/suggest?q=${'a'.repeat(51)}`)
      .set('Authorization', `Bearer ${authToken}`);

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });
});
