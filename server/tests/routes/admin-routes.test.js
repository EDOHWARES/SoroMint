const request = require('supertest');
const express = require('express');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

const User = require('../../models/User');
const Stream = require('../../models/Stream');
const SystemConfig = require('../../models/SystemConfig');
const adminRoutes = require('../../routes/admin-routes');
const { errorHandler } = require('../../middleware/error-handler');

const ADMIN_PUBLIC_KEY =
  'GBN77V4V6O2ZXB5LTVE3XA5SUQ66YDFVYQEOMQ5LQCKW4YME7W6F6MJM';
const USER_PUBLIC_KEY =
  'GDZYF2MVD4MMJIDNVTVCKRWP7F55N56CGKUCLH7SZ7KJQLGMMFMNVOVP';

let mongoServer;
let app;
let adminUser;
let regularUser;
let adminToken;
let userToken;

const createToken = (user) =>
  jwt.sign(
    {
      id: user._id,
      publicKey: user.publicKey,
      role: user.role,
      type: 'access',
    },
    process.env.JWT_SECRET
  );

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri());

  process.env.JWT_SECRET = 'test-secret-key-admin-routes';
  process.env.JWT_EXPIRES_IN = '1h';

  adminUser = await User.create({
    publicKey: ADMIN_PUBLIC_KEY,
    username: 'admin-user',
    role: 'admin',
    status: 'active',
  });

  regularUser = await User.create({
    publicKey: USER_PUBLIC_KEY,
    username: 'regular-user',
    role: 'user',
    status: 'active',
  });

  adminToken = createToken(adminUser);
  userToken = createToken(regularUser);

  app = express();
  app.use(express.json());
  app.use('/api', adminRoutes);
  app.use(errorHandler);
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

beforeEach(async () => {
  await Stream.deleteMany({});
  await SystemConfig.deleteMany({});
});

describe('Admin Dashboard Routes', () => {
  describe('GET /api/admin/metrics', () => {
    it('requires authentication', async () => {
      const response = await request(app).get('/api/admin/metrics');

      expect(response.status).toBe(401);
    });

    it('requires admin privileges', async () => {
      const response = await request(app)
        .get('/api/admin/metrics')
        .set('Authorization', `Bearer ${userToken}`);

      expect(response.status).toBe(403);
    });

    it('returns system-wide metrics for admins', async () => {
      await Stream.create([
        {
          streamId: 'stream-1',
          contractId: 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAB',
          sender: USER_PUBLIC_KEY,
          recipient: ADMIN_PUBLIC_KEY,
          tokenAddress:
            'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
          totalAmount: '100',
          ratePerLedger: '1',
          startLedger: 1,
          stopLedger: 100,
          createdTxHash: 'tx-hash-1',
          status: 'active',
        },
        {
          streamId: 'stream-2',
          contractId: 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAC',
          sender: USER_PUBLIC_KEY,
          recipient: ADMIN_PUBLIC_KEY,
          tokenAddress:
            'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
          totalAmount: '50',
          ratePerLedger: '1',
          startLedger: 2,
          stopLedger: 50,
          createdTxHash: 'tx-hash-2',
          status: 'canceled',
        },
      ]);

      const response = await request(app)
        .get('/api/admin/metrics')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.users.total).toBeGreaterThanOrEqual(2);
      expect(response.body.data.streams.total).toBe(2);
      expect(response.body.data.streams.active).toBe(1);
      expect(response.body.data.tvl.totalValueLocked).toBe(100);
    });
  });

  describe('GET /api/admin/tvl', () => {
    it('returns TVL data for admins', async () => {
      await Stream.create({
        streamId: 'stream-3',
        contractId: 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD',
        sender: USER_PUBLIC_KEY,
        recipient: ADMIN_PUBLIC_KEY,
        tokenAddress: 'CBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB',
        totalAmount: '250.5',
        ratePerLedger: '2',
        startLedger: 10,
        stopLedger: 110,
        createdTxHash: 'tx-hash-3',
        status: 'active',
      });

      const response = await request(app)
        .get('/api/admin/tvl')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.totalValueLocked).toBe(250.5);
      expect(response.body.data.activeStreamCount).toBe(1);
    });
  });

  describe('Maintenance mode endpoints', () => {
    it('toggles maintenance mode', async () => {
      const patchResponse = await request(app)
        .patch('/api/admin/maintenance')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ enabled: true });

      expect(patchResponse.status).toBe(200);
      expect(patchResponse.body.data.maintenanceMode).toBe(true);

      const getResponse = await request(app)
        .get('/api/admin/maintenance')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(getResponse.status).toBe(200);
      expect(getResponse.body.data.maintenanceMode).toBe(true);
    });

    it('validates maintenance mode payload', async () => {
      const response = await request(app)
        .patch('/api/admin/maintenance')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ enabled: 'yes' });

      expect(response.status).toBe(400);
    });
  });

  describe('User management endpoints', () => {
    it('bans and unbans a user', async () => {
      const banResponse = await request(app)
        .patch(`/api/admin/users/${regularUser._id}/ban`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(banResponse.status).toBe(200);
      expect(banResponse.body.data.status).toBe('suspended');

      const suspendedUser = await User.findById(regularUser._id);
      expect(suspendedUser.status).toBe('suspended');

      const unbanResponse = await request(app)
        .patch(`/api/admin/users/${regularUser._id}/unban`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(unbanResponse.status).toBe(200);
      expect(unbanResponse.body.data.status).toBe('active');

      const activeUser = await User.findById(regularUser._id);
      expect(activeUser.status).toBe('active');
    });
  });
});
