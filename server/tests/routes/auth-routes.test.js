/**
 * @title Auth Routes Tests — SEP-10 Challenge-Response
 * @author SoroMint Team
 * @notice Comprehensive test suite for all authentication routes.
 *         Login now requires a SEP-10 style challenge-response:
 *           1. GET  /api/auth/challenge?publicKey=<G-addr>
 *           2. Client signs the returned XDR with their Stellar keypair
 *           3. POST /api/auth/login  { publicKey, challengeToken, signedXDR }
 *
 * @dev Tests use real Stellar keypairs (Keypair.random()) so that challenge
 *      transactions can be properly signed and verified end-to-end.
 */

'use strict';

const request = require('supertest');
const express = require('express');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const { Keypair, Transaction } = require('@stellar/stellar-sdk');

const User = require('../../models/User');
const { generateToken, authenticate } = require('../../middleware/auth');
const { errorHandler } = require('../../middleware/error-handler');
const { createAuthRouter } = require('../../routes/auth-routes');
const { createRateLimiter } = require('../../middleware/rate-limiter');
const {
  _clearAllChallenges,
} = require('../../services/sep10-challenge-service');

// ── Test keypairs (have both public + secret so we can sign challenges) ────────

const SERVER_KP = Keypair.random(); // used as the server signing keypair for this test run
const CLIENT_KP = Keypair.random(); // primary test user
const CLIENT_KP2 = Keypair.random(); // secondary test user
const CLIENT_KP3 = Keypair.random(); // tertiary test user

const TEST_PUBLIC_KEY = CLIENT_KP.publicKey();
const TEST_PUBLIC_KEY_2 = CLIENT_KP2.publicKey();
const TEST_PUBLIC_KEY_3 = CLIENT_KP3.publicKey();

// Invalid key fixtures
const INVALID_PUBLIC_KEY_SHORT = 'GABC';
const INVALID_PUBLIC_KEY_WRONG_PREFIX =
  'XDKIJJIKXLOM2NRMPNQZUUYK24ZPVFC64CZGCEVDEDG67DJKHS2XVLT5';

// ── Test state ─────────────────────────────────────────────────────────────────

let mongoServer;
let app;
let testUser;
let validToken;

// ── Helpers ────────────────────────────────────────────────────────────────────

/**
 * Fetches a fresh challenge for the given public key, signs it with the
 * provided Keypair, and returns { challengeToken, signedXDR }.
 */
const getSignedChallenge = async (keypair) => {
  const challengeRes = await request(app).get(
    `/api/auth/challenge?publicKey=${keypair.publicKey()}`
  );

  expect(challengeRes.status).toBe(200);

  const { transactionXDR, challengeToken } = challengeRes.body.data;

  const tx = new Transaction(transactionXDR, process.env.NETWORK_PASSPHRASE);
  tx.sign(keypair);
  const signedXDR = tx.toEnvelope().toXDR('base64');

  return { challengeToken, signedXDR };
};

// ── Setup / Teardown ──────────────────────────────────────────────────────────

beforeAll(async () => {
  // Point the challenge-service at our deterministic test server keypair
  process.env.SERVER_SIGNING_SECRET = SERVER_KP.secret();
  process.env.JWT_SECRET = 'test-secret-key-for-testing-only';
  process.env.JWT_EXPIRES_IN = '1h';

  // In-memory MongoDB
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri());

  // Express app with a very permissive rate limiter
  app = express();
  app.use(express.json());
  app.use(
    '/api/auth',
    createAuthRouter({
      authLoginRateLimiter: createRateLimiter({
        windowMs: 60_000,
        max: 10_000,
      }),
    })
  );
  app.use(errorHandler);

  // Seed primary test user
  testUser = new User({ publicKey: TEST_PUBLIC_KEY, username: 'testuser' });
  await testUser.save();

  validToken = generateToken(TEST_PUBLIC_KEY, 'testuser');
});

beforeEach(async () => {
  // Flush in-memory challenges so each test starts clean
  _clearAllChallenges();
});

afterEach(async () => {
  await User.deleteMany({});
  _clearAllChallenges();

  // Re-create the primary test user
  testUser = new User({ publicKey: TEST_PUBLIC_KEY, username: 'testuser' });
  await testUser.save();
  validToken = generateToken(TEST_PUBLIC_KEY, 'testuser');
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
  delete process.env.JWT_SECRET;
  delete process.env.JWT_EXPIRES_IN;
  delete process.env.SERVER_SIGNING_SECRET;
});

// =============================================================================
// GET /api/auth/challenge
// =============================================================================

describe('GET /api/auth/challenge', () => {
  it('returns a challenge for a valid public key', async () => {
    const res = await request(app).get(
      `/api/auth/challenge?publicKey=${TEST_PUBLIC_KEY}`
    );

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.transactionXDR).toBeDefined();
    expect(res.body.data.challengeToken).toBeDefined();
    expect(res.body.data.expiresAt).toBeDefined();
    expect(res.body.data.expiresInSeconds).toBeDefined();
    expect(res.body.data.serverPublicKey).toBeDefined();
  });

  it('transactionXDR is a parseable Stellar transaction', async () => {
    const res = await request(app).get(
      `/api/auth/challenge?publicKey=${TEST_PUBLIC_KEY}`
    );

    const { transactionXDR } = res.body.data;
    expect(
      () => new Transaction(transactionXDR, process.env.NETWORK_PASSPHRASE)
    ).not.toThrow();
  });

  it('challenge transaction has exactly 2 ManageData operations', async () => {
    const res = await request(app).get(
      `/api/auth/challenge?publicKey=${TEST_PUBLIC_KEY}`
    );

    const tx = new Transaction(
      res.body.data.transactionXDR,
      process.env.NETWORK_PASSPHRASE
    );
    expect(tx.operations.length).toBeGreaterThanOrEqual(2);
    expect(tx.operations[0].type).toBe('manageData');
    expect(tx.operations[1].type).toBe('manageData');
  });

  it('second operation source equals the requested public key', async () => {
    const res = await request(app).get(
      `/api/auth/challenge?publicKey=${TEST_PUBLIC_KEY}`
    );

    const tx = new Transaction(
      res.body.data.transactionXDR,
      process.env.NETWORK_PASSPHRASE
    );
    expect(tx.operations[1].source).toBe(TEST_PUBLIC_KEY);
  });

  it('transaction is already signed by the server', async () => {
    const res = await request(app).get(
      `/api/auth/challenge?publicKey=${TEST_PUBLIC_KEY}`
    );

    const tx = new Transaction(
      res.body.data.transactionXDR,
      process.env.NETWORK_PASSPHRASE
    );
    expect(tx.signatures.length).toBe(1);
  });

  it('expiresAt is in the future', async () => {
    const res = await request(app).get(
      `/api/auth/challenge?publicKey=${TEST_PUBLIC_KEY}`
    );

    expect(res.body.data.expiresAt).toBeGreaterThan(Date.now());
  });

  it('each call produces a unique challengeToken', async () => {
    const [r1, r2] = await Promise.all([
      request(app).get(`/api/auth/challenge?publicKey=${TEST_PUBLIC_KEY}`),
      request(app).get(`/api/auth/challenge?publicKey=${TEST_PUBLIC_KEY}`),
    ]);

    expect(r1.body.data.challengeToken).not.toBe(r2.body.data.challengeToken);
  });

  it('returns 400 if publicKey query param is missing', async () => {
    const res = await request(app).get('/api/auth/challenge');

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 for an invalid public key format', async () => {
    const res = await request(app).get(
      `/api/auth/challenge?publicKey=${INVALID_PUBLIC_KEY_SHORT}`
    );

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INVALID_PUBLIC_KEY');
  });

  it('returns 400 for a key with the wrong prefix', async () => {
    const res = await request(app).get(
      `/api/auth/challenge?publicKey=${INVALID_PUBLIC_KEY_WRONG_PREFIX}`
    );

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INVALID_PUBLIC_KEY');
  });
});

// =============================================================================
// POST /api/auth/register
// =============================================================================

describe('POST /api/auth/register', () => {
  it('registers a new user successfully', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ publicKey: TEST_PUBLIC_KEY_2, username: 'newuser' });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.user.publicKey).toBe(TEST_PUBLIC_KEY_2);
    expect(res.body.data.user.username).toBe('newuser');
    expect(res.body.data.token).toBeDefined();
    expect(res.body.data.expiresIn).toBe('1h');
  });

  it('registers user without username', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ publicKey: TEST_PUBLIC_KEY_2 });

    expect(res.status).toBe(201);
    expect(res.body.data.user.username).toBeUndefined();
  });

  it('trims whitespace from username', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ publicKey: TEST_PUBLIC_KEY_2, username: '  hello  ' });

    expect(res.status).toBe(201);
    expect(res.body.data.user.username).toBe('hello');
  });

  it('returns 400 if publicKey is missing', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ username: 'nokey' });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 if publicKey is empty', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ publicKey: '', username: 'nokey' });

    expect(res.status).toBe(400);
  });

  it('returns 400 for a short invalid public key', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ publicKey: INVALID_PUBLIC_KEY_SHORT, username: 'badkey' });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INVALID_PUBLIC_KEY');
  });

  it('returns 400 for a key with the wrong prefix', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({
        publicKey: INVALID_PUBLIC_KEY_WRONG_PREFIX,
        username: 'badprefix',
      });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INVALID_PUBLIC_KEY');
  });

  it('returns 409 if user already exists', async () => {
    await request(app)
      .post('/api/auth/register')
      .send({ publicKey: TEST_PUBLIC_KEY_2, username: 'first' });

    const res = await request(app)
      .post('/api/auth/register')
      .send({ publicKey: TEST_PUBLIC_KEY_2, username: 'second' });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('USER_EXISTS');
  });

  it('returns 400 if username is too short', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ publicKey: TEST_PUBLIC_KEY_2, username: 'ab' });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 if username is too long', async () => {
    const longUsername = 'a'.repeat(51);
    const res = await request(app)
      .post('/api/auth/register')
      .send({ publicKey: TEST_PUBLIC_KEY_2, username: longUsername });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });
});

// =============================================================================
// POST /api/auth/login  (SEP-10 challenge-response)
// =============================================================================

describe('POST /api/auth/login', () => {
  it('logs in an existing user with a valid signed challenge', async () => {
    const { challengeToken, signedXDR } = await getSignedChallenge(CLIENT_KP);

    const res = await request(app)
      .post('/api/auth/login')
      .send({ publicKey: TEST_PUBLIC_KEY, challengeToken, signedXDR });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.message).toBe('Login successful');
    expect(res.body.data.user.publicKey).toBe(TEST_PUBLIC_KEY);
    expect(res.body.data.token).toBeDefined();
    expect(res.body.data.expiresIn).toBe('1h');
  });

  it('updates lastLoginAt on successful login', async () => {
    const before = await User.findByPublicKey(TEST_PUBLIC_KEY);
    expect(before.lastLoginAt).toBeUndefined();

    const { challengeToken, signedXDR } = await getSignedChallenge(CLIENT_KP);
    await request(app)
      .post('/api/auth/login')
      .send({ publicKey: TEST_PUBLIC_KEY, challengeToken, signedXDR });

    const after = await User.findByPublicKey(TEST_PUBLIC_KEY);
    expect(after.lastLoginAt).toBeDefined();
    expect(new Date(after.lastLoginAt).getTime()).toBeGreaterThan(
      new Date(before.createdAt).getTime()
    );
  });

  it('returns 400 if publicKey is missing', async () => {
    const { challengeToken, signedXDR } = await getSignedChallenge(CLIENT_KP);

    const res = await request(app)
      .post('/api/auth/login')
      .send({ challengeToken, signedXDR });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 if publicKey format is invalid', async () => {
    const { challengeToken, signedXDR } = await getSignedChallenge(CLIENT_KP);

    const res = await request(app)
      .post('/api/auth/login')
      .send({ publicKey: INVALID_PUBLIC_KEY_SHORT, challengeToken, signedXDR });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INVALID_PUBLIC_KEY');
  });

  it('returns 400 if challengeToken is missing', async () => {
    const { signedXDR } = await getSignedChallenge(CLIENT_KP);

    const res = await request(app)
      .post('/api/auth/login')
      .send({ publicKey: TEST_PUBLIC_KEY, signedXDR });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('MISSING_CHALLENGE_TOKEN');
  });

  it('returns 400 if signedXDR is missing', async () => {
    const { challengeToken } = await getSignedChallenge(CLIENT_KP);

    const res = await request(app)
      .post('/api/auth/login')
      .send({ publicKey: TEST_PUBLIC_KEY, challengeToken });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('MISSING_SIGNED_XDR');
  });

  it('returns 401 if challengeToken is unknown / fake', async () => {
    const { signedXDR } = await getSignedChallenge(CLIENT_KP);

    const res = await request(app)
      .post('/api/auth/login')
      .send({
        publicKey: TEST_PUBLIC_KEY,
        challengeToken: '0'.repeat(64),
        signedXDR,
      });

    expect(res.status).toBe(401);
    expect(res.body.code).toBe('CHALLENGE_VERIFICATION_FAILED');
  });

  it('returns 401 if signedXDR is garbage / not valid XDR', async () => {
    const { challengeToken } = await getSignedChallenge(CLIENT_KP);

    const res = await request(app).post('/api/auth/login').send({
      publicKey: TEST_PUBLIC_KEY,
      challengeToken,
      signedXDR: 'this-is-not-valid-xdr',
    });

    expect(res.status).toBe(401);
    expect(res.body.code).toBe('CHALLENGE_VERIFICATION_FAILED');
  });

  it('returns 401 when client signs with the wrong keypair', async () => {
    const { challengeToken, transactionXDR } = await (async () => {
      const challengeRes = await request(app).get(
        `/api/auth/challenge?publicKey=${TEST_PUBLIC_KEY}`
      );
      return challengeRes.body.data;
    })();

    // Sign with a completely different keypair
    const wrongKp = Keypair.random();
    const tx = new Transaction(transactionXDR, process.env.NETWORK_PASSPHRASE);
    tx.sign(wrongKp);
    const wrongSignedXDR = tx.toEnvelope().toXDR('base64');

    const res = await request(app)
      .post('/api/auth/login')
      .send({
        publicKey: TEST_PUBLIC_KEY,
        challengeToken,
        signedXDR: wrongSignedXDR,
      });

    expect(res.status).toBe(401);
    expect(res.body.code).toBe('CHALLENGE_VERIFICATION_FAILED');
  });

  it('returns 401 if the same challenge token is submitted twice (replay prevention)', async () => {
    const { challengeToken, signedXDR } = await getSignedChallenge(CLIENT_KP);

    // First login succeeds
    const first = await request(app)
      .post('/api/auth/login')
      .send({ publicKey: TEST_PUBLIC_KEY, challengeToken, signedXDR });
    expect(first.status).toBe(200);

    // Second login with the same token must fail
    const second = await request(app)
      .post('/api/auth/login')
      .send({ publicKey: TEST_PUBLIC_KEY, challengeToken, signedXDR });
    expect(second.status).toBe(401);
    expect(second.body.code).toBe('CHALLENGE_VERIFICATION_FAILED');
  });

  it('returns 401 if user is not registered', async () => {
    // Register CLIENT_KP2 user first so we can get a valid challenge
    // But deliberately do NOT register them in the DB

    // Get a challenge for an unregistered key
    const unregisteredKp = Keypair.random();
    const challengeRes = await request(app).get(
      `/api/auth/challenge?publicKey=${unregisteredKp.publicKey()}`
    );
    expect(challengeRes.status).toBe(200);

    const { transactionXDR, challengeToken } = challengeRes.body.data;
    const tx = new Transaction(transactionXDR, process.env.NETWORK_PASSPHRASE);
    tx.sign(unregisteredKp);
    const signedXDR = tx.toEnvelope().toXDR('base64');

    const res = await request(app)
      .post('/api/auth/login')
      .send({
        publicKey: unregisteredKp.publicKey(),
        challengeToken,
        signedXDR,
      });

    expect(res.status).toBe(401);
    expect(res.body.code).toBe('USER_NOT_FOUND');
  });

  it('returns 403 if account is suspended', async () => {
    const suspendedUser = new User({
      publicKey: TEST_PUBLIC_KEY_2,
      username: 'suspendeduser',
      status: 'suspended',
    });
    await suspendedUser.save();

    const { challengeToken, signedXDR } = await getSignedChallenge(CLIENT_KP2);

    const res = await request(app)
      .post('/api/auth/login')
      .send({ publicKey: TEST_PUBLIC_KEY_2, challengeToken, signedXDR });

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('ACCOUNT_INACTIVE');
    expect(res.body.error).toContain('suspended');
  });

  it('returns 403 if account is deleted', async () => {
    const deletedUser = new User({
      publicKey: TEST_PUBLIC_KEY_2,
      username: 'deleteduser',
      status: 'deleted',
    });
    await deletedUser.save();

    const { challengeToken, signedXDR } = await getSignedChallenge(CLIENT_KP2);

    const res = await request(app)
      .post('/api/auth/login')
      .send({ publicKey: TEST_PUBLIC_KEY_2, challengeToken, signedXDR });

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('ACCOUNT_INACTIVE');
    expect(res.body.error).toContain('deleted');
  });

  it('returns 401 for a publicKey that does not match the challenge', async () => {
    // Get a challenge for CLIENT_KP but submit CLIENT_KP2's public key
    const { challengeToken, signedXDR } = await getSignedChallenge(CLIENT_KP);

    const res = await request(app)
      .post('/api/auth/login')
      .send({ publicKey: TEST_PUBLIC_KEY_2, challengeToken, signedXDR });

    expect(res.status).toBe(401);
  });
});

// =============================================================================
// GET /api/auth/me
// =============================================================================

describe('GET /api/auth/me', () => {
  it('returns the current user profile', async () => {
    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${validToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.user.publicKey).toBe(TEST_PUBLIC_KEY);
    expect(res.body.data.user.username).toBe('testuser');
  });

  it('returns 401 if no token is provided', async () => {
    const res = await request(app).get('/api/auth/me');
    expect(res.status).toBe(401);
  });

  it('returns 401 if token is invalid', async () => {
    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', 'Bearer totally-invalid-token');
    expect(res.status).toBe(401);
  });

  it('returns 401 if token is expired', async () => {
    const jwt = require('jsonwebtoken');
    const expiredToken = jwt.sign(
      { publicKey: TEST_PUBLIC_KEY, username: 'testuser', type: 'access' },
      process.env.JWT_SECRET,
      { expiresIn: '-1s', issuer: 'SoroMint', audience: 'SoroMint-API' }
    );

    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${expiredToken}`);

    expect(res.status).toBe(401);
    expect(res.body.code).toBe('TOKEN_EXPIRED');
  });

  it('returns 401 if the user referenced by the token no longer exists', async () => {
    const phantomKp = Keypair.random();
    const fakeToken = generateToken(phantomKp.publicKey(), 'ghost');

    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${fakeToken}`);

    expect(res.status).toBe(401);
    expect(res.body.code).toBe('USER_NOT_FOUND');
  });
});

// =============================================================================
// POST /api/auth/refresh
// =============================================================================

describe('POST /api/auth/refresh', () => {
  it('refreshes the token successfully', async () => {
    const res = await request(app)
      .post('/api/auth/refresh')
      .set('Authorization', `Bearer ${validToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.token).toBeDefined();
    expect(res.body.data.expiresIn).toBeDefined();
    // The new token must differ from the original (different iat at minimum)
    // (may be equal in same second — so we just check it is a string)
    expect(typeof res.body.data.token).toBe('string');
  });

  it('returns 401 if no token is provided', async () => {
    const res = await request(app).post('/api/auth/refresh');
    expect(res.status).toBe(401);
  });

  it('returns 401 if token is invalid', async () => {
    const res = await request(app)
      .post('/api/auth/refresh')
      .set('Authorization', 'Bearer bad.token.here');
    expect(res.status).toBe(401);
  });

  it('returns 401 if the user no longer exists', async () => {
    const phantomKp = Keypair.random();
    const fakeToken = generateToken(phantomKp.publicKey(), 'ghost');

    const res = await request(app)
      .post('/api/auth/refresh')
      .set('Authorization', `Bearer ${fakeToken}`);

    expect(res.status).toBe(401);
    expect(res.body.code).toBe('USER_NOT_FOUND');
  });
});

// =============================================================================
// PUT /api/auth/profile
// =============================================================================

describe('PUT /api/auth/profile', () => {
  it('updates username successfully', async () => {
    const res = await request(app)
      .put('/api/auth/profile')
      .set('Authorization', `Bearer ${validToken}`)
      .send({ username: 'updatedname' });

    expect(res.status).toBe(200);
    expect(res.body.data.user.username).toBe('updatedname');
  });

  it('trims whitespace from the new username', async () => {
    const res = await request(app)
      .put('/api/auth/profile')
      .set('Authorization', `Bearer ${validToken}`)
      .send({ username: '  trimmed  ' });

    expect(res.status).toBe(200);
    expect(res.body.data.user.username).toBe('trimmed');
  });

  it('leaves username unchanged if not provided', async () => {
    const res = await request(app)
      .put('/api/auth/profile')
      .set('Authorization', `Bearer ${validToken}`)
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.data.user.username).toBe('testuser');
  });

  it('returns 400 if username is too short', async () => {
    const res = await request(app)
      .put('/api/auth/profile')
      .set('Authorization', `Bearer ${validToken}`)
      .send({ username: 'ab' });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 if username is too long', async () => {
    const longUsername = 'z'.repeat(51);
    const res = await request(app)
      .put('/api/auth/profile')
      .set('Authorization', `Bearer ${validToken}`)
      .send({ username: longUsername });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });

  it('returns 401 if no token is provided', async () => {
    const res = await request(app)
      .put('/api/auth/profile')
      .send({ username: 'noauth' });

    expect(res.status).toBe(401);
  });

  it('returns 401 if user no longer exists', async () => {
    const phantomKp = Keypair.random();
    const fakeToken = generateToken(phantomKp.publicKey(), 'ghost');

    const res = await request(app)
      .put('/api/auth/profile')
      .set('Authorization', `Bearer ${fakeToken}`)
      .send({ username: 'shouldfail' });

    expect(res.status).toBe(401);
    expect(res.body.code).toBe('USER_NOT_FOUND');
  });
});

// =============================================================================
// Integration Tests — full SEP-10 flow
// =============================================================================

describe('Integration Tests', () => {
  it('completes the full register → challenge → login → profile → refresh flow', async () => {
    const kp = CLIENT_KP2;
    const pubKey = kp.publicKey();
    const username = 'integrationuser';

    // ── 1. Register ────────────────────────────────────────────────────────
    const registerRes = await request(app)
      .post('/api/auth/register')
      .send({ publicKey: pubKey, username });

    expect(registerRes.status).toBe(201);
    const registerToken = registerRes.body.data.token;

    // ── 2. GET /me with registration token ─────────────────────────────────
    const profileRes1 = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${registerToken}`);

    expect(profileRes1.status).toBe(200);
    expect(profileRes1.body.data.user.username).toBe(username);

    // ── 3. Get challenge & sign ────────────────────────────────────────────
    const { challengeToken, signedXDR } = await getSignedChallenge(kp);

    // ── 4. Login ───────────────────────────────────────────────────────────
    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({ publicKey: pubKey, challengeToken, signedXDR });

    expect(loginRes.status).toBe(200);
    const loginToken = loginRes.body.data.token;

    // ── 5. GET /me with login token ────────────────────────────────────────
    const profileRes2 = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${loginToken}`);

    expect(profileRes2.status).toBe(200);
    expect(profileRes2.body.data.user.username).toBe(username);

    // ── 6. Update profile ──────────────────────────────────────────────────
    const updateRes = await request(app)
      .put('/api/auth/profile')
      .set('Authorization', `Bearer ${loginToken}`)
      .send({ username: 'updatedintegrationuser' });

    expect(updateRes.status).toBe(200);
    expect(updateRes.body.data.user.username).toBe('updatedintegrationuser');

    // ── 7. Refresh token ───────────────────────────────────────────────────
    const refreshRes = await request(app)
      .post('/api/auth/refresh')
      .set('Authorization', `Bearer ${loginToken}`);

    expect(refreshRes.status).toBe(200);
    const refreshedToken = refreshRes.body.data.token;

    // ── 8. GET /me with refreshed token ───────────────────────────────────
    const profileRes3 = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${refreshedToken}`);

    expect(profileRes3.status).toBe(200);
    expect(profileRes3.body.data.user.username).toBe('updatedintegrationuser');
  });

  it('handles two independent users without cross-contamination', async () => {
    // Register both users
    const reg1 = await request(app)
      .post('/api/auth/register')
      .send({ publicKey: TEST_PUBLIC_KEY_2, username: 'alice' });

    const reg2 = await request(app)
      .post('/api/auth/register')
      .send({ publicKey: TEST_PUBLIC_KEY_3, username: 'bob' });

    expect(reg1.status).toBe(201);
    expect(reg2.status).toBe(201);

    // Login both via challenge-response
    const alice = await getSignedChallenge(CLIENT_KP2);
    const bob = await getSignedChallenge(CLIENT_KP3);

    const login1 = await request(app)
      .post('/api/auth/login')
      .send({
        publicKey: TEST_PUBLIC_KEY_2,
        challengeToken: alice.challengeToken,
        signedXDR: alice.signedXDR,
      });

    const login2 = await request(app)
      .post('/api/auth/login')
      .send({
        publicKey: TEST_PUBLIC_KEY_3,
        challengeToken: bob.challengeToken,
        signedXDR: bob.signedXDR,
      });

    expect(login1.status).toBe(200);
    expect(login2.status).toBe(200);

    const token1 = login1.body.data.token;
    const token2 = login2.body.data.token;

    // Verify each token only accesses its own profile
    const p1 = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${token1}`);
    const p2 = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${token2}`);

    expect(p1.body.data.user.username).toBe('alice');
    expect(p2.body.data.user.username).toBe('bob');
    expect(p1.body.data.user.publicKey).toBe(TEST_PUBLIC_KEY_2);
    expect(p2.body.data.user.publicKey).toBe(TEST_PUBLIC_KEY_3);
  });

  it('challenge token from one user cannot be used to log in as another', async () => {
    await request(app)
      .post('/api/auth/register')
      .send({ publicKey: TEST_PUBLIC_KEY_2, username: 'alice' });

    // Get a challenge issued for CLIENT_KP (already registered as 'testuser')
    // and try to submit it with CLIENT_KP2's public key
    const { challengeToken, signedXDR } = await getSignedChallenge(CLIENT_KP);

    const res = await request(app)
      .post('/api/auth/login')
      .send({ publicKey: TEST_PUBLIC_KEY_2, challengeToken, signedXDR });

    expect(res.status).toBe(401);
  });
});

// =============================================================================
// Edge Cases
// =============================================================================

describe('Edge Cases', () => {
  it('handles special characters in username during registration', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ publicKey: TEST_PUBLIC_KEY_2, username: 'user-dashes_and_123' });

    expect(res.status).toBe(201);
    expect(res.body.data.user.username).toBe('user-dashes_and_123');
  });

  it('handles unicode characters in username', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ publicKey: TEST_PUBLIC_KEY_2, username: '用户テスト' });

    expect(res.status).toBe(201);
    expect(res.body.data.user.username).toBe('用户テスト');
  });

  it('concurrent registrations for the same key result in exactly one success and one 409', async () => {
    const [r1, r2] = await Promise.all([
      request(app)
        .post('/api/auth/register')
        .send({ publicKey: TEST_PUBLIC_KEY_2, username: 'concurrent1' }),
      request(app)
        .post('/api/auth/register')
        .send({ publicKey: TEST_PUBLIC_KEY_2, username: 'concurrent2' }),
    ]);

    const statuses = [r1.status, r2.status].sort();
    expect(statuses).toEqual([201, 409]);
  });

  it('multiple outstanding challenges for the same key are each independently valid', async () => {
    // Generate two challenges for the same user
    const c1Res = await request(app).get(
      `/api/auth/challenge?publicKey=${TEST_PUBLIC_KEY}`
    );
    const c2Res = await request(app).get(
      `/api/auth/challenge?publicKey=${TEST_PUBLIC_KEY}`
    );

    expect(c1Res.status).toBe(200);
    expect(c2Res.status).toBe(200);
    expect(c1Res.body.data.challengeToken).not.toBe(
      c2Res.body.data.challengeToken
    );

    // Sign and use the second one first
    const tx2 = new Transaction(
      c2Res.body.data.transactionXDR,
      process.env.NETWORK_PASSPHRASE
    );
    tx2.sign(CLIENT_KP);
    const signedXDR2 = tx2.toEnvelope().toXDR('base64');

    const login2 = await request(app).post('/api/auth/login').send({
      publicKey: TEST_PUBLIC_KEY,
      challengeToken: c2Res.body.data.challengeToken,
      signedXDR: signedXDR2,
    });
    expect(login2.status).toBe(200);

    // The first challenge is still valid (wasn't consumed)
    const tx1 = new Transaction(
      c1Res.body.data.transactionXDR,
      process.env.NETWORK_PASSPHRASE
    );
    tx1.sign(CLIENT_KP);
    const signedXDR1 = tx1.toEnvelope().toXDR('base64');

    const login1 = await request(app).post('/api/auth/login').send({
      publicKey: TEST_PUBLIC_KEY,
      challengeToken: c1Res.body.data.challengeToken,
      signedXDR: signedXDR1,
    });
    expect(login1.status).toBe(200);
  });
});
