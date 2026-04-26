const request = require('supertest');
const express = require('express');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const { MongoMemoryServer } = require('mongodb-memory-server');
const DeploymentAudit = require('../../models/DeploymentAudit');
const User = require('../../models/User');
const Token = require('../../models/Token');
const auditRoutes = require('../../routes/audit-routes');
const { errorHandler, asyncHandler } = require('../../middleware/error-handler');

// Mock index.js structure for testing the integration
const setupApp = () => {
  const app = express();
  app.use(express.json());
  
  // Mock authentication middleware
  app.use((req, res, next) => {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.substring(7);
      const decoded = jwt.decode(token);
      req.user = { _id: decoded.id, publicKey: decoded.publicKey, role: decoded.role || 'user' };
    }
    next();
  });

  // Simplified version of the POST /api/tokens logic
  app.post('/api/tokens', asyncHandler(async (req, res) => {
    const { name, symbol, ownerPublicKey } = req.body;
    const userId = req.user._id;

    if (!name || !symbol || !ownerPublicKey) {
      await DeploymentAudit.create({
        userId,
        tokenName: name || 'Unknown',
        status: 'FAIL',
        errorMessage: 'Missing required fields'
      });
      return res.status(400).json({ message: 'Validation error' });
    }

    try {
      const newToken = new Token(req.body);
      await newToken.save();
      await DeploymentAudit.create({
        userId,
        tokenName: name,
        status: 'SUCCESS'
      });
      res.status(201).json(newToken);
    } catch (error) {
      await DeploymentAudit.create({
        userId,
        tokenName: name,
        status: 'FAIL',
        errorMessage: error.message
      });
      res.status(500).json({ message: error.message });
    }
  }));

  app.use('/api', auditRoutes);
  app.use(errorHandler);
  return app;
};

let mongoServer;
let app;
let testUser;
let adminUser;
let userToken;
let adminToken;

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  const mongoUri = mongoServer.getUri();
  await mongoose.connect(mongoUri);

  // Setup test users
  testUser = await User.create({
    publicKey: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
    username: 'testuser',
    status: 'active'
  });

  adminUser = await User.create({
    publicKey: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAB',
    username: 'adminuser',
    status: 'active',
    role: 'admin'
  });

  // Mock JWT secret for testing if needed, but we're decoding manually in our mock middleware
  process.env.JWT_SECRET = 'testsecret';

  userToken = jwt.sign({ id: testUser._id, publicKey: testUser.publicKey, role: 'user' }, 'testsecret');
  adminToken = jwt.sign({ id: adminUser._id, publicKey: adminUser.publicKey, role: 'admin' }, 'testsecret');

  app = setupApp();
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

describe('Deployment Audit Logs', () => {
  beforeEach(async () => {
    await DeploymentAudit.deleteMany({});
    await Token.deleteMany({});
  });

  describe('Integration with Deployment', () => {
    it('should log SUCCESS when token deployment succeeds', async () => {
      const response = await request(app)
        .post('/api/tokens')
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          name: 'Success Token',
          symbol: 'SUCC',
          decimals: 7,
          contractId: 'CA123...',
          ownerPublicKey: testUser.publicKey
        });

      expect(response.status).toBe(201);
      
      const audit = await DeploymentAudit.findOne({ tokenName: 'Success Token' });
      expect(audit).toBeDefined();
      expect(audit.status).toBe('SUCCESS');
      expect(audit.userId.toString()).toBe(testUser._id.toString());
    });

    it('should log FAIL when token deployment fails due to validation', async () => {
      const response = await request(app)
        .post('/api/tokens')
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          name: 'Fail Token'
          // missing status etc
        });

      expect(response.status).toBe(400);
      
      const audit = await DeploymentAudit.findOne({ tokenName: 'Fail Token' });
      expect(audit).toBeDefined();
      expect(audit.status).toBe('FAIL');
      expect(audit.errorMessage).toContain('Missing required fields');
    });

    it('should log FAIL when token deployment fails due to duplicate contractId', async () => {
      // First one succeeds
      await Token.create({
        name: 'First',
        symbol: 'FST',
        contractId: 'DUPE',
        ownerPublicKey: testUser.publicKey
      });

      // Second one fails with duplicate key error
      const response = await request(app)
        .post('/api/tokens')
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          name: 'Second',
          symbol: 'SND',
          contractId: 'DUPE',
          ownerPublicKey: testUser.publicKey
        });

      expect(response.status).toBe(500);
      
      const audit = await DeploymentAudit.findOne({ tokenName: 'Second' });
      expect(audit).toBeDefined();
      expect(audit.status).toBe('FAIL');
      expect(audit.errorMessage).toBeDefined();
    });
  });

  describe('Audit Log API', () => {
    beforeEach(async () => {
      await DeploymentAudit.create([
        { userId: testUser._id, tokenName: 'User Token 1', status: 'SUCCESS' },
        { userId: testUser._id, tokenName: 'User Token 2', status: 'FAIL', errorMessage: 'Oops' },
        { userId: adminUser._id, tokenName: 'Admin Token', status: 'SUCCESS' }
      ]);
    });

    it('should return user-specific logs for regular users', async () => {
      const response = await request(app)
        .get('/api/logs')
        .set('Authorization', `Bearer ${userToken}`);

      expect(response.status).toBe(200);
      expect(response.body.length).toBe(2);
      expect(response.body.every(log => log.userId.toString() === testUser._id.toString())).toBe(true);
    });

    it('should return all logs for admins via admin endpoint', async () => {
      const response = await request(app)
        .get('/api/admin/logs')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(response.status).toBe(200);
      expect(response.body.length).toBe(3);
    });

    it('should allow filtering admin logs by status', async () => {
      const response = await request(app)
        .get('/api/admin/logs')
        .query({ status: 'FAIL' })
        .set('Authorization', `Bearer ${adminToken}`);

      expect(response.status).toBe(200);
      expect(response.body.length).toBe(1);
      expect(response.body[0].tokenName).toBe('User Token 2');
    });

    it('should deny non-admin access to admin endpoint', async () => {
      const response = await request(app)
        .get('/api/admin/logs')
        .set('Authorization', `Bearer ${userToken}`);

      expect(response.status).toBe(403);
    });
  });
});
