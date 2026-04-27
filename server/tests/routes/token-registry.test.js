const request = require('supertest');
const express = require('express');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const Token = require('../../models/Token');
const User = require('../../models/User');
const { generateToken } = require('../../middleware/auth');
const { errorHandler } = require('../../middleware/error-handler');
const { createTokenRouter } = require('../../routes/token-routes');

// Mock stellar-service
jest.mock('../../services/stellar-service', () => ({
  getTokenMetadata: jest.fn(),
  getRpcServer: jest.fn(),
}));

const { getTokenMetadata } = require('../../services/stellar-service');

let mongoServer;
let app;
let testUser;
let validAuthToken;

const TEST_PUBLIC_KEY = 'GDZYF2MVD4MMJIDNVTVCKRWP7F55N56CGKUCLH7SZ7KJQLGMMFMNVOVP';
const TEST_CONTRACT_ID = 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri());

  process.env.JWT_SECRET = 'test-secret';
  process.env.JWT_EXPIRES_IN = '1h';

  app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.correlationId = 'test-id';
    next();
  });
  app.use('/api', createTokenRouter());
  app.use(errorHandler);

  testUser = new User({
    publicKey: TEST_PUBLIC_KEY,
    username: 'tester',
  });
  await testUser.save();

  validAuthToken = generateToken(testUser);
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

describe('Token Registry Routes', () => {
  beforeEach(async () => {
    await Token.deleteMany({});
    jest.clearAllMocks();
  });

  describe('GET /api/v1/tokens/:address', () => {
    it('should return token from DB if it exists', async () => {
      const existingToken = new Token({
        name: 'Existing Token',
        symbol: 'EXT',
        decimals: 7,
        contractId: TEST_CONTRACT_ID,
        ownerPublicKey: TEST_PUBLIC_KEY,
      });
      await existingToken.save();

      const response = await request(app)
        .get(`/api/v1/tokens/${TEST_CONTRACT_ID}`)
        .set('Authorization', `Bearer ${validAuthToken}`);

      expect(response.status).toBe(200);
      expect(response.body.data.name).toBe('Existing Token');
      expect(response.body.source).toBe('db');
      expect(getTokenMetadata).not.toHaveBeenCalled();
    });

    it('should fetch from chain and cache in DB if not in DB', async () => {
      getTokenMetadata.mockResolvedValue({
        name: 'Chain Token',
        symbol: 'CHN',
        decimals: 9,
      });

      const response = await request(app)
        .get(`/api/v1/tokens/${TEST_CONTRACT_ID}`)
        .set('Authorization', `Bearer ${validAuthToken}`);

      expect(response.status).toBe(200);
      expect(response.body.data.name).toBe('Chain Token');
      expect(response.body.source).toBe('chain');
      expect(getTokenMetadata).toHaveBeenCalledWith(TEST_CONTRACT_ID);

      // Verify it's now in DB
      const inDb = await Token.findOne({ contractId: TEST_CONTRACT_ID });
      expect(inDb).toBeDefined();
      expect(inDb.name).toBe('Chain Token');
    });

    it('should return 404 if fetch from chain fails', async () => {
      getTokenMetadata.mockRejectedValue(new Error('Contract not found'));

      const response = await request(app)
        .get(`/api/v1/tokens/${TEST_CONTRACT_ID}`)
        .set('Authorization', `Bearer ${validAuthToken}`);

      expect(response.status).toBe(404);
      expect(response.body.code).toBe('FETCH_FAILED');
    });
  });

  describe('GET /api/v1/tokens', () => {
    it('should list all registered tokens', async () => {
      await Token.create([
        { name: 'T1', symbol: 'S1', contractId: 'C1', ownerPublicKey: 'G1' },
        { name: 'T2', symbol: 'S2', contractId: 'C2', ownerPublicKey: 'G2' },
      ]);

      const response = await request(app)
        .get('/api/v1/tokens')
        .set('Authorization', `Bearer ${validAuthToken}`);

      expect(response.status).toBe(200);
      expect(response.body.data).toHaveLength(2);
      expect(response.body.metadata.totalCount).toBe(2);
    });
  });
});
