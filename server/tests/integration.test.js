/**
 * @title SoroMint API Integration Tests
 * @author p3ris0n
 * @notice End-to-end integration tests exercising complete user workflows
 *         across all API components (routes → middleware → validators → models → DB).
 * @dev Uses MongoMemoryServer for an isolated test database.
 *      Unlike unit tests, this file mounts ALL routes on a single Express app,
 *      mirrors the real index.js setup, and chains real JWT tokens + DB state
 *      across test steps — validating that components integrate correctly.
 */

const request = require('supertest');
const express = require('express');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

// Models
const Token = require('../models/Token');
const User = require('../models/User');
const DeploymentAudit = require('../models/DeploymentAudit');

// Middleware & helpers
const { generateToken } = require('../middleware/auth');
const {
  errorHandler,
  notFoundHandler,
} = require('../middleware/error-handler');

// Routes
const authRoutes = require('../routes/auth-routes');
const tokenRoutes = require('../routes/token-routes');
const auditRoutes = require('../routes/audit-routes');
const statusRoutes = require('../routes/status-routes');

// ---------------------------------------------------------------------------
// Test constants
// ---------------------------------------------------------------------------

/** @notice Valid Stellar Ed25519 public keys for testing */
const USER_A_KEY = 'GDZYF2MVD4MMJIDNVTVCKRWP7F55N56CGKUCLH7SZ7KJQLGMMFMNVOVP';
const USER_B_KEY = 'GA2DQGWZTIICWQ7MZ5VZ6CKKXQOGCDHUUFIFO7YUG6SGX63BVG433GZD';

/** @notice Valid Stellar contract IDs (C-address, 56 chars) */
const CONTRACT_A1 = 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const CONTRACT_A2 = 'CBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB';
const CONTRACT_B1 = 'CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC';

// ---------------------------------------------------------------------------
// Shared state
// ---------------------------------------------------------------------------

let mongoServer;
let app;

// ---------------------------------------------------------------------------
// Setup & Teardown
// ---------------------------------------------------------------------------

beforeAll(async () => {
  // Spin up in-memory MongoDB
  mongoServer = await MongoMemoryServer.create();
  const mongoUri = mongoServer.getUri();
  await mongoose.connect(mongoUri);

  // Set required environment variables for JWT & Stellar
  process.env.JWT_SECRET = 'integration-test-secret-key';
  process.env.JWT_EXPIRES_IN = '1h';
  process.env.NODE_ENV = 'test';
  process.env.NETWORK_PASSPHRASE = 'Test SDF Network ; September 2015';

  // Import Express app identical to production wiring (index.js)
  const { createApp } = require('../index');
  app = createApp();
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
  delete process.env.JWT_SECRET;
  delete process.env.JWT_EXPIRES_IN;
  delete process.env.NODE_ENV;
  delete process.env.NETWORK_PASSPHRASE;
});

// ---------------------------------------------------------------------------
// Flow 1 — Complete Token Lifecycle
// Register → Create Token → List Tokens → Search → Verify Audit
// ---------------------------------------------------------------------------

describe('Flow 1: Complete Token Lifecycle', () => {
  let jwtToken;
  let userId;

  afterAll(async () => {
    await Token.deleteMany({});
    await User.deleteMany({});
    await DeploymentAudit.deleteMany({});
  });

  it('Step 1 — Register a new user and receive a JWT', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ publicKey: USER_A_KEY, username: 'lifecycle' });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.token).toBeDefined();
    expect(res.body.data.user.publicKey).toBe(USER_A_KEY);

    jwtToken = res.body.data.token;
    userId = res.body.data.user.id;
  });

  it('Step 2 — Create a token with the JWT', async () => {
    const res = await request(app)
      .post('/api/tokens')
      .set('Authorization', `Bearer ${jwtToken}`)
      .send({
        name: 'SoroMint Gold',
        symbol: 'SGOLD',
        decimals: 7,
        contractId: CONTRACT_A1,
        ownerPublicKey: USER_A_KEY,
      });

    expect(res.status).toBe(201);
    expect(res.body.name).toBe('SoroMint Gold');
    expect(res.body.symbol).toBe('SGOLD');
    expect(res.body.contractId).toBe(CONTRACT_A1);
  });

  it('Step 3 — List tokens and verify the created token appears', async () => {
    const res = await request(app)
      .get(`/api/tokens/${USER_A_KEY}`)
      .set('Authorization', `Bearer ${jwtToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].symbol).toBe('SGOLD');
    expect(res.body.metadata.totalCount).toBe(1);
  });

  it('Step 4 — Create a second token, then search and verify filtering', async () => {
    // Create a second token
    const createRes = await request(app)
      .post('/api/tokens')
      .set('Authorization', `Bearer ${jwtToken}`)
      .send({
        name: 'SoroMint Silver',
        symbol: 'SSILVER',
        decimals: 7,
        contractId: CONTRACT_A2,
        ownerPublicKey: USER_A_KEY,
      });

    expect(createRes.status).toBe(201);

    // Search for "gold" — should only return SGOLD
    const searchRes = await request(app)
      .get(`/api/tokens/${USER_A_KEY}?search=gold`)
      .set('Authorization', `Bearer ${jwtToken}`);

    expect(searchRes.status).toBe(200);
    expect(searchRes.body.data).toHaveLength(1);
    expect(searchRes.body.data[0].symbol).toBe('SGOLD');
    expect(searchRes.body.metadata.search).toBe('gold');
    expect(searchRes.body.metadata.totalCount).toBe(1);

    // Search for "soromint" — should return both
    const searchRes2 = await request(app)
      .get(`/api/tokens/${USER_A_KEY}?search=soromint`)
      .set('Authorization', `Bearer ${jwtToken}`);

    expect(searchRes2.status).toBe(200);
    expect(searchRes2.body.data).toHaveLength(2);
    expect(searchRes2.body.metadata.totalCount).toBe(2);
  });

  it('Step 5 — Verify DeploymentAudit logs were auto-created', async () => {
    const audits = await DeploymentAudit.find({ userId }).sort({
      createdAt: 1,
    });

    expect(audits).toHaveLength(2);
    expect(audits[0].tokenName).toBe('SoroMint Gold');
    expect(audits[0].status).toBe('SUCCESS');
    expect(audits[0].contractId).toBe(CONTRACT_A1);
    expect(audits[1].tokenName).toBe('SoroMint Silver');
    expect(audits[1].status).toBe('SUCCESS');
  });
});

// ---------------------------------------------------------------------------
// Flow 2 — Auth → Audit Log Flow
// Register → Login → Create Token → Query Audit Logs → Refresh JWT
// ---------------------------------------------------------------------------

describe('Flow 2: Auth → Audit Log Flow', () => {
  let registerToken;
  let loginToken;

  afterAll(async () => {
    await Token.deleteMany({});
    await User.deleteMany({});
    await DeploymentAudit.deleteMany({});
  });

  it('Step 1 — Register produces a valid JWT', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ publicKey: USER_A_KEY, username: 'auditflow' });

    expect(res.status).toBe(201);
    registerToken = res.body.data.token;

    // Verify token works immediately
    const meRes = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${registerToken}`);

    expect(meRes.status).toBe(200);
    expect(meRes.body.data.user.username).toBe('auditflow');
  });

  it('Step 2 — Login produces a valid JWT for the same user', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ publicKey: USER_A_KEY });

    expect(res.status).toBe(200);
    expect(res.body.data.token).toBeDefined();
    loginToken = res.body.data.token;

    // Login token works for /me
    const meRes = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${loginToken}`);

    expect(meRes.status).toBe(200);
    expect(meRes.body.data.user.publicKey).toBe(USER_A_KEY);
  });

  it('Step 3 — Create token, then verify audit log via GET /api/logs', async () => {
    // Create a token
    await request(app)
      .post('/api/tokens')
      .set('Authorization', `Bearer ${loginToken}`)
      .send({
        name: 'Audit Test Token',
        symbol: 'AUDIT',
        decimals: 7,
        contractId: CONTRACT_A1,
        ownerPublicKey: USER_A_KEY,
      });

    // Query audit logs endpoint
    const logsRes = await request(app)
      .get('/api/logs')
      .set('Authorization', `Bearer ${loginToken}`);

    expect(logsRes.status).toBe(200);
    expect(Array.isArray(logsRes.body)).toBe(true);
    expect(logsRes.body.length).toBeGreaterThanOrEqual(1);

    const auditEntry = logsRes.body.find(
      (log) => log.tokenName === 'Audit Test Token'
    );
    expect(auditEntry).toBeDefined();
    expect(auditEntry.status).toBe('SUCCESS');
    expect(auditEntry.contractId).toBe(CONTRACT_A1);
  });

  it('Step 4 — Refresh JWT and verify the new token works', async () => {
    const refreshRes = await request(app)
      .post('/api/auth/refresh')
      .set('Authorization', `Bearer ${loginToken}`);

    expect(refreshRes.status).toBe(200);
    expect(refreshRes.body.data.token).toBeDefined();

    const refreshedToken = refreshRes.body.data.token;

    // Verify refreshed token works for authenticated endpoints
    const meRes = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${refreshedToken}`);

    expect(meRes.status).toBe(200);
    expect(meRes.body.data.user.publicKey).toBe(USER_A_KEY);
  });
});

// ---------------------------------------------------------------------------
// Flow 3 — Multi-User Isolation
// Two users register, each creates tokens; verify data isolation
// ---------------------------------------------------------------------------

describe('Flow 3: Multi-User Isolation', () => {
  let tokenA;
  let tokenB;

  afterAll(async () => {
    await Token.deleteMany({});
    await User.deleteMany({});
    await DeploymentAudit.deleteMany({});
  });

  it('Step 1 — Register two independent users', async () => {
    const resA = await request(app)
      .post('/api/auth/register')
      .send({ publicKey: USER_A_KEY, username: 'userA' });

    const resB = await request(app)
      .post('/api/auth/register')
      .send({ publicKey: USER_B_KEY, username: 'userB' });

    expect(resA.status).toBe(201);
    expect(resB.status).toBe(201);

    tokenA = resA.body.data.token;
    tokenB = resB.body.data.token;
  });

  it('Step 2 — Each user creates tokens under their own key', async () => {
    // User A creates a token
    const resA = await request(app)
      .post('/api/tokens')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({
        name: 'Alpha Coin',
        symbol: 'ALPHA',
        decimals: 7,
        contractId: CONTRACT_A1,
        ownerPublicKey: USER_A_KEY,
      });

    expect(resA.status).toBe(201);

    // User B creates a token
    const resB = await request(app)
      .post('/api/tokens')
      .set('Authorization', `Bearer ${tokenB}`)
      .send({
        name: 'Beta Coin',
        symbol: 'BETA',
        decimals: 7,
        contractId: CONTRACT_B1,
        ownerPublicKey: USER_B_KEY,
      });

    expect(resB.status).toBe(201);
  });

  it("Step 3 — Listing tokens returns only the authenticated user's tokens", async () => {
    // User A lists their tokens
    const resA = await request(app)
      .get(`/api/tokens/${USER_A_KEY}`)
      .set('Authorization', `Bearer ${tokenA}`);

    expect(resA.status).toBe(200);
    expect(resA.body.data).toHaveLength(1);
    expect(resA.body.data[0].symbol).toBe('ALPHA');

    // User B lists their tokens
    const resB = await request(app)
      .get(`/api/tokens/${USER_B_KEY}`)
      .set('Authorization', `Bearer ${tokenB}`);

    expect(resB.status).toBe(200);
    expect(resB.body.data).toHaveLength(1);
    expect(resB.body.data[0].symbol).toBe('BETA');
  });

  it("Step 4 — Audit logs return only the authenticated user's entries", async () => {
    // User A's audit logs
    const logsA = await request(app)
      .get('/api/logs')
      .set('Authorization', `Bearer ${tokenA}`);

    expect(logsA.status).toBe(200);
    expect(logsA.body.every((log) => log.tokenName !== 'Beta Coin')).toBe(true);
    expect(logsA.body.some((log) => log.tokenName === 'Alpha Coin')).toBe(true);

    // User B's audit logs
    const logsB = await request(app)
      .get('/api/logs')
      .set('Authorization', `Bearer ${tokenB}`);

    expect(logsB.status).toBe(200);
    expect(logsB.body.every((log) => log.tokenName !== 'Alpha Coin')).toBe(
      true
    );
    expect(logsB.body.some((log) => log.tokenName === 'Beta Coin')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Flow 4 — Error Propagation Across Stack
// Verifies that validation, auth, and duplicate-key errors propagate correctly
// ---------------------------------------------------------------------------

describe('Flow 4: Error Propagation Across Stack', () => {
  let validJwt;

  beforeAll(async () => {
    const user = new User({
      publicKey: USER_A_KEY,
      username: 'erroruser',
    });
    await user.save();
    validJwt = generateToken(USER_A_KEY, 'erroruser');
  });

  afterAll(async () => {
    await Token.deleteMany({});
    await User.deleteMany({});
    await DeploymentAudit.deleteMany({});
  });

  it('should return 401 when creating a token without authentication', async () => {
    const res = await request(app).post('/api/tokens').send({
      name: 'No Auth Token',
      symbol: 'NOAUTH',
      decimals: 7,
      contractId: CONTRACT_A1,
      ownerPublicKey: USER_A_KEY,
    });

    expect(res.status).toBe(401);
    expect(res.body.code).toBe('AUTH_REQUIRED');
  });

  it('should return 400 when creating a token with invalid data (Zod → error handler)', async () => {
    const res = await request(app)
      .post('/api/tokens')
      .set('Authorization', `Bearer ${validJwt}`)
      .send({
        name: 'X', // Too short (min 3)
        symbol: 'lowercase', // Must be uppercase
        decimals: 25, // Max 18
        contractId: 'INVALID', // Must be 56 chars starting with C
        ownerPublicKey: 'INVALID', // Must be 56 chars starting with G
      });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
    expect(res.body.error).toBeDefined();
  });

  it('should return 409 when creating a token with duplicate contractId', async () => {
    // First creation — should succeed
    const first = await request(app)
      .post('/api/tokens')
      .set('Authorization', `Bearer ${validJwt}`)
      .send({
        name: 'Original Token',
        symbol: 'ORIG',
        decimals: 7,
        contractId: CONTRACT_A1,
        ownerPublicKey: USER_A_KEY,
      });

    expect(first.status).toBe(201);

    // Duplicate creation — same contractId
    const duplicate = await request(app)
      .post('/api/tokens')
      .set('Authorization', `Bearer ${validJwt}`)
      .send({
        name: 'Duplicate Token',
        symbol: 'DUP',
        decimals: 7,
        contractId: CONTRACT_A1,
        ownerPublicKey: USER_A_KEY,
      });

    expect(duplicate.status).toBe(409);
    expect(duplicate.body.code).toBe('DUPLICATE_KEY');
  });

  it('should return 404 for undefined routes', async () => {
    const res = await request(app)
      .get('/api/nonexistent')
      .set('Authorization', `Bearer ${validJwt}`);

    expect(res.status).toBe(404);
    expect(res.body.code).toBe('ROUTE_NOT_FOUND');
  });
});

// ---------------------------------------------------------------------------
// Flow 5 — Health Check
// ---------------------------------------------------------------------------

describe('Flow 5: Health Check Integration', () => {
  it('should report healthy status with database connected', async () => {
    const res = await request(app).get('/api/health');

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('healthy');
    expect(res.body.services.database.status).toBe('up');
    expect(res.body.services.database.connection).toBe('connected');
    expect(res.body.version).toBeDefined();
    expect(res.body.uptime).toBeDefined();
    expect(res.body.timestamp).toBeDefined();
  });

  it('should include Stellar network configuration', async () => {
    const res = await request(app).get('/api/health');

    expect(res.status).toBe(200);
    expect(res.body.services.stellar.network).toBe(
      'Test SDF Network ; September 2015'
    );
  });
});
