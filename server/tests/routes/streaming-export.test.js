const request = require('supertest');
const express = require('express');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const { MongoMemoryServer } = require('mongodb-memory-server');
const Stream = require('../../models/Stream');
const User = require('../../models/User');
const streamingRoutes = require('../../routes/streaming-routes');
const { errorHandler } = require('../../middleware/error-handler');

let mongoServer, app, testUser, userToken;

const PK = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const PK_OTHER = 'GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB';

const setupApp = () => {
  const a = express();
  a.use(express.json());
  a.use((req, _res, next) => {
    req.correlationId = 'test-id';
    const h = req.headers.authorization;
    if (h?.startsWith('Bearer ')) {
      const d = jwt.decode(h.substring(7));
      req.user = { _id: d.id, publicKey: d.publicKey };
    }
    next();
  });
  a.use('/api/streaming', streamingRoutes);
  a.use(errorHandler);
  return a;
};

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri());
  process.env.JWT_SECRET = 'testsecret';

  testUser = await User.create({ publicKey: PK, username: 'tester' });
  userToken = jwt.sign({ id: testUser._id, publicKey: PK }, 'testsecret');
  app = setupApp();
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

beforeEach(async () => {
  await Stream.deleteMany({});
});

describe('GET /api/streaming/export', () => {
  const seed = async () => {
    await Stream.create([
      {
        streamId: '1',
        contractId: 'C1',
        sender: PK,
        recipient: PK_OTHER,
        tokenAddress: 'T1',
        totalAmount: '1000',
        ratePerLedger: '10',
        startLedger: 100,
        stopLedger: 200,
        status: 'active',
        createdTxHash: 'hash1',
        createdAt: new Date('2024-01-15'),
      },
      {
        streamId: '2',
        contractId: 'C1',
        sender: PK_OTHER,
        recipient: PK,
        tokenAddress: 'T1',
        totalAmount: '2000',
        ratePerLedger: '20',
        startLedger: 300,
        stopLedger: 400,
        status: 'completed',
        createdTxHash: 'hash2',
        createdAt: new Date('2024-02-20'),
      },
      {
        streamId: '3',
        contractId: 'C2',
        sender: 'GCCCCCC',
        recipient: 'GDDDDDD',
        tokenAddress: 'T2',
        totalAmount: '3000',
        ratePerLedger: '30',
        startLedger: 500,
        stopLedger: 600,
        status: 'active',
        createdTxHash: 'hash3',
        createdAt: new Date('2024-03-10'),
      },
    ]);
  };

  it('returns CSV with correct headers and data', async () => {
    await seed();
    const res = await request(app)
      .get('/api/streaming/export')
      .set('Authorization', `Bearer ${userToken}`);

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/csv/);
    expect(res.text).toContain(
      'streamId,contractId,sender,recipient,tokenAddress'
    );

    const lines = res.text.trim().split('\n');
    expect(lines).toHaveLength(3); // header + 2 rows (PK is sender in #1 and recipient in #2)
    expect(res.text).toContain('"1"');
    expect(res.text).toContain('"2"');
    expect(res.text).not.toContain('"3"');
  });

  it('filters by startDate and endDate', async () => {
    await seed();
    const res = await request(app)
      .get('/api/streaming/export?startDate=2024-02-01&endDate=2024-02-28')
      .set('Authorization', `Bearer ${userToken}`);

    const lines = res.text.trim().split('\n');
    expect(lines).toHaveLength(2); // header + row #2
    expect(res.text).toContain('"2"');
    expect(res.text).not.toContain('"1"');
  });

  it('returns JSON format correctly', async () => {
    await seed();
    const res = await request(app)
      .get('/api/streaming/export?format=json')
      .set('Authorization', `Bearer ${userToken}`);

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/json/);
    expect(res.body.success).toBe(true);
    expect(res.body.count).toBe(2);
    expect(res.body.data[0].streamId).toBe('2');
  });

  it('returns 400 for invalid dates', async () => {
    const res = await request(app)
      .get('/api/streaming/export?startDate=invalid')
      .set('Authorization', `Bearer ${userToken}`);

    expect(res.status).toBe(400);
    expect(res.body.errors[0].msg).toBe('Invalid startDate format');
  });

  it('requires authentication', async () => {
    const res = await request(app).get('/api/streaming/export');
    expect(res.status).toBe(401);
  });
});
