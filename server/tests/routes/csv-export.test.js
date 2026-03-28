const request = require('supertest');
const express = require('express');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const { MongoMemoryServer } = require('mongodb-memory-server');
const DeploymentAudit = require('../../models/DeploymentAudit');
const User = require('../../models/User');
const auditRoutes = require('../../routes/audit-routes');
const { errorHandler } = require('../../middleware/error-handler');

let mongoServer, app, testUser, userToken;

const PK = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

const setupApp = () => {
  const a = express();
  a.use(express.json());
  a.use((req, _res, next) => {
    const h = req.headers.authorization;
    if (h?.startsWith('Bearer ')) {
      const d = jwt.decode(h.substring(7));
      req.user = { _id: d.id, publicKey: d.publicKey, role: d.role || 'user' };
    }
    next();
  });
  a.use('/api', auditRoutes);
  a.use(errorHandler);
  return a;
};

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri());
  process.env.JWT_SECRET = 'testsecret';

  testUser = await User.create({ publicKey: PK, username: 'tester' });
  userToken = jwt.sign({ id: testUser._id, publicKey: PK, role: 'user' }, 'testsecret');
  app = setupApp();
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

beforeEach(async () => {
  await DeploymentAudit.deleteMany({});
});

describe('GET /api/logs/export', () => {
  const seed = async () => {
    await DeploymentAudit.create([
      { userId: testUser._id, tokenName: 'Alpha', contractId: 'CA1', status: 'SUCCESS', createdAt: new Date('2024-01-15') },
      { userId: testUser._id, tokenName: 'Beta',  contractId: 'CA2', status: 'FAIL',    errorMessage: 'err', createdAt: new Date('2024-02-20') },
      { userId: testUser._id, tokenName: 'Gamma', contractId: 'CA3', status: 'SUCCESS', createdAt: new Date('2024-03-10') },
    ]);
  };

  it('returns CSV with correct headers', async () => {
    await seed();
    const res = await request(app)
      .get('/api/logs/export')
      .set('Authorization', `Bearer ${userToken}`);

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/csv/);
    expect(res.headers['content-disposition']).toMatch(/attachment/);
    expect(res.text).toMatch(/^id,tokenName,contractId,status,errorMessage,createdAt\n/);
  });

  it('contains all records when no date filter', async () => {
    await seed();
    const res = await request(app)
      .get('/api/logs/export')
      .set('Authorization', `Bearer ${userToken}`);

    const lines = res.text.trim().split('\n');
    expect(lines).toHaveLength(4); // header + 3 rows
  });

  it('filters by from date', async () => {
    await seed();
    const res = await request(app)
      .get('/api/logs/export?from=2024-02-01')
      .set('Authorization', `Bearer ${userToken}`);

    const lines = res.text.trim().split('\n');
    expect(lines).toHaveLength(3); // header + Beta + Gamma
    expect(res.text).not.toContain('Alpha');
  });

  it('filters by to date', async () => {
    await seed();
    const res = await request(app)
      .get('/api/logs/export?to=2024-01-31')
      .set('Authorization', `Bearer ${userToken}`);

    const lines = res.text.trim().split('\n');
    expect(lines).toHaveLength(2); // header + Alpha
    expect(res.text).toContain('Alpha');
    expect(res.text).not.toContain('Beta');
  });

  it('filters by from and to date range', async () => {
    await seed();
    const res = await request(app)
      .get('/api/logs/export?from=2024-02-01&to=2024-02-28')
      .set('Authorization', `Bearer ${userToken}`);

    const lines = res.text.trim().split('\n');
    expect(lines).toHaveLength(2); // header + Beta
    expect(res.text).toContain('Beta');
  });

  it('returns 400 for invalid from date', async () => {
    const res = await request(app)
      .get('/api/logs/export?from=not-a-date')
      .set('Authorization', `Bearer ${userToken}`);

    expect(res.status).toBe(400);
  });

  it('returns 400 for invalid to date', async () => {
    const res = await request(app)
      .get('/api/logs/export?to=not-a-date')
      .set('Authorization', `Bearer ${userToken}`);

    expect(res.status).toBe(400);
  });

  it('returns empty CSV (header only) when no records match', async () => {
    const res = await request(app)
      .get('/api/logs/export?from=2099-01-01')
      .set('Authorization', `Bearer ${userToken}`);

    expect(res.status).toBe(200);
    expect(res.text.trim()).toBe('id,tokenName,contractId,status,errorMessage,createdAt');
  });

  it('requires authentication', async () => {
    const res = await request(app).get('/api/logs/export');
    expect(res.status).toBe(401);
  });

  it('escapes commas in field values', async () => {
    await DeploymentAudit.create({
      userId: testUser._id,
      tokenName: 'Token, With Comma',
      status: 'FAIL',
      errorMessage: 'error, detail',
    });

    const res = await request(app)
      .get('/api/logs/export')
      .set('Authorization', `Bearer ${userToken}`);

    expect(res.text).toContain('"Token, With Comma"');
    expect(res.text).toContain('"error, detail"');
  });
});
