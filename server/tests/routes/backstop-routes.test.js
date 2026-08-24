/**
 * @title Backstop Routes Tests
 * @description Test suite for the Backstop (insurance fund) API endpoints.
 *              The Soroban service layer is mocked so these tests focus on
 *              routing, auth, validation, response shapes and structured logging.
 */

jest.mock('../../services/backstop-service', () => ({
  getConfig: jest.fn(),
  getBalance: jest.fn(),
  getVersion: jest.fn(),
  depositFee: jest.fn(),
  withdraw: jest.fn(),
  setFeeBps: jest.fn(),
  BackstopServiceError: class BackstopServiceError extends Error {
    constructor(message, statusCode = 500, code = 'BACKSTOP_SERVICE_ERROR') {
      super(message);
      this.name = 'BackstopServiceError';
      this.statusCode = statusCode;
      this.code = code;
      this.isOperational = true;
    }
  },
}));

const request = require('supertest');
const express = require('express');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const backstopRoutes = require('../../routes/backstop-routes');
const backstopService = require('../../services/backstop-service');
const { errorHandler } = require('../../middleware/error-handler');
const { generateToken } = require('../../middleware/auth');
const { logger } = require('../../utils/logger');
const User = require('../../models/User');

let mongoServer;
let app;
let testUser;
let validToken;

const TEST_PUBLIC_KEY =
  'GDZYF2MVD4MMJIDNVTVCKRWP7F55N56CGKUCLH7SZ7KJQLGMMFMNVOVP';

// Contract C-address and account addresses (56-char base32 strings).
const TEST_CONTRACT_ID = `C${'A'.repeat(55)}`;
const TEST_FROM_ADDRESS = `G${'B'.repeat(55)}`;
const TEST_TO_ADDRESS = `G${'C'.repeat(55)}`;

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri());

  process.env.JWT_SECRET = 'test-secret-key-for-testing';
  process.env.JWT_EXPIRES_IN = '1h';

  app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.correlationId = 'test-correlation-id';
    next();
  });

  app.use('/api', backstopRoutes);
  app.use(errorHandler);

  testUser = await User.create({
    publicKey: TEST_PUBLIC_KEY,
    email: 'test@example.com',
    role: 'user',
  });

  validToken = generateToken(TEST_PUBLIC_KEY, 'test@example.com');
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

afterEach(() => {
  jest.clearAllMocks();
  jest.restoreAllMocks();
});

describe('Backstop Routes - Reads', () => {
  it('GET /api/backstop/:contractId/config returns the normalized config', async () => {
    backstopService.getConfig.mockResolvedValue({
      admin: TEST_PUBLIC_KEY,
      token: TEST_FROM_ADDRESS,
      fee_bps: 100,
      total_deposited: '500000000',
      total_withdrawn: '0',
    });

    const response = await request(app).get(
      `/api/backstop/${TEST_CONTRACT_ID}/config`
    );

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data).toMatchObject({
      admin: TEST_PUBLIC_KEY,
      token: TEST_FROM_ADDRESS,
      fee_bps: 100,
    });
    expect(backstopService.getConfig).toHaveBeenCalledWith(
      TEST_CONTRACT_ID,
      expect.objectContaining({ correlationId: 'test-correlation-id' })
    );
  });

  it('GET /api/backstop/:contractId/balance returns the reserve balance', async () => {
    backstopService.getBalance.mockResolvedValue({ balance: '1200000000' });

    const response = await request(app).get(
      `/api/backstop/${TEST_CONTRACT_ID}/balance`
    );

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.balance).toBe('1200000000');
  });

  it('GET /api/backstop/:contractId/version returns the contract version', async () => {
    backstopService.getVersion.mockResolvedValue({ version: '0.1.0' });

    const response = await request(app).get(
      `/api/backstop/${TEST_CONTRACT_ID}/version`
    );

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.version).toBe('0.1.0');
  });

  it('rejects an invalid contractId with 400', async () => {
    const response = await request(app).get('/api/backstop/not-a-valid-address/config');

    expect(response.status).toBe(400);
    expect(response.body.code).toBe('BACKSTOP_VALIDATION_ERROR');
    expect(backstopService.getConfig).not.toHaveBeenCalled();
  });
});

describe('Backstop Routes - Writes', () => {
  it('POST /api/backstop/:contractId/deposit requires authentication', async () => {
    const response = await request(app)
      .post(`/api/backstop/${TEST_CONTRACT_ID}/deposit`)
      .send({ from: TEST_FROM_ADDRESS, amount: 1000 });

    expect(response.status).toBe(401);
    expect(backstopService.depositFee).not.toHaveBeenCalled();
  });

  it('POST /api/backstop/:contractId/deposit submits a fee deposit', async () => {
    backstopService.depositFee.mockResolvedValue({
      success: true,
      txHash: 'a1b2c3',
      status: 'SUCCESS',
    });

    const response = await request(app)
      .post(`/api/backstop/${TEST_CONTRACT_ID}/deposit`)
      .set('Authorization', `Bearer ${validToken}`)
      .send({ from: TEST_FROM_ADDRESS, amount: 1000 });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data).toEqual({
      success: true,
      txHash: 'a1b2c3',
      status: 'SUCCESS',
    });
    expect(backstopService.depositFee).toHaveBeenCalledWith(
      expect.objectContaining({
        contractId: TEST_CONTRACT_ID,
        from: TEST_FROM_ADDRESS,
        amount: 1000,
        correlationId: 'test-correlation-id',
        userId: expect.anything(),
      })
    );
  });

  it('POST /api/backstop/:contractId/deposit rejects an invalid amount', async () => {
    const response = await request(app)
      .post(`/api/backstop/${TEST_CONTRACT_ID}/deposit`)
      .set('Authorization', `Bearer ${validToken}`)
      .send({ from: TEST_FROM_ADDRESS, amount: -5 });

    expect(response.status).toBe(400);
    expect(response.body.code).toBe('BACKSTOP_VALIDATION_ERROR');
    expect(backstopService.depositFee).not.toHaveBeenCalled();
  });

  it('POST /api/backstop/:contractId/withdraw submits an admin withdrawal', async () => {
    backstopService.withdraw.mockResolvedValue({
      success: true,
      txHash: 'deadbeef',
      status: 'SUCCESS',
    });

    const response = await request(app)
      .post(`/api/backstop/${TEST_CONTRACT_ID}/withdraw`)
      .set('Authorization', `Bearer ${validToken}`)
      .send({ to: TEST_TO_ADDRESS, amount: 250 });

    expect(response.status).toBe(200);
    expect(response.body.data.txHash).toBe('deadbeef');
    expect(backstopService.withdraw).toHaveBeenCalledWith(
      expect.objectContaining({
        contractId: TEST_CONTRACT_ID,
        to: TEST_TO_ADDRESS,
        amount: 250,
      })
    );
  });

  it('PATCH /api/backstop/:contractId/fee updates the fee rate', async () => {
    backstopService.setFeeBps.mockResolvedValue({
      success: true,
      txHash: 'cafebabe',
      status: 'SUCCESS',
    });

    const response = await request(app)
      .patch(`/api/backstop/${TEST_CONTRACT_ID}/fee`)
      .set('Authorization', `Bearer ${validToken}`)
      .send({ fee_bps: 50 });

    expect(response.status).toBe(200);
    expect(response.body.data.txHash).toBe('cafebabe');
    expect(backstopService.setFeeBps).toHaveBeenCalledWith(
      expect.objectContaining({ contractId: TEST_CONTRACT_ID, fee_bps: 50 })
    );
  });

  it('PATCH /api/backstop/:contractId/fee rejects fee_bps above 10000', async () => {
    const response = await request(app)
      .patch(`/api/backstop/${TEST_CONTRACT_ID}/fee`)
      .set('Authorization', `Bearer ${validToken}`)
      .send({ fee_bps: 10001 });

    expect(response.status).toBe(400);
    expect(response.body.code).toBe('BACKSTOP_VALIDATION_ERROR');
    expect(backstopService.setFeeBps).not.toHaveBeenCalled();
  });
});

describe('Backstop Routes - Structured logging', () => {
  it('emits structured log entries with correlationId and userId context', async () => {
    const infoSpy = jest.spyOn(logger, 'info');

    backstopService.depositFee.mockResolvedValue({
      success: true,
      txHash: 'a1b2c3',
      status: 'SUCCESS',
    });

    await request(app)
      .post(`/api/backstop/${TEST_CONTRACT_ID}/deposit`)
      .set('Authorization', `Bearer ${validToken}`)
      .send({ from: TEST_FROM_ADDRESS, amount: 500 });

    const backstopLogs = infoSpy.mock.calls.filter(
      ([message]) => typeof message === 'string' && message.includes('Backstop')
    );

    expect(backstopLogs.length).toBeGreaterThan(0);

    const payload = backstopLogs[0][1];
    expect(payload).toMatchObject({
      correlationId: 'test-correlation-id',
      userId: expect.anything(),
    });
    expect(typeof payload).toBe('object');
  });
});


