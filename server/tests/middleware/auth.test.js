/**
 * @title Auth Middleware Tests
 * @author SoroMint Team
 * @notice Comprehensive test suite for JWT authentication middleware
 * @dev Tests cover authenticate, optionalAuthenticate, authorize, and token utilities
 */

const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const User = require('../../models/User');
const {
  authenticate,
  optionalAuthenticate,
  authorize,
  generateToken,
  decodeToken,
  verifyToken,
  extractTokenFromHeader
} = require('../../middleware/auth');
const { errorHandler, AppError } = require('../../middleware/error-handler');

// Test environment setup
let mongoServer;
let testUser;
let validToken;
let expiredToken;
let invalidToken;

// Valid Stellar public keys for testing (generated via Keypair.random())
const TEST_PUBLIC_KEY = 'GDZYF2MVD4MMJIDNVTVCKRWP7F55N56CGKUCLH7SZ7KJQLGMMFMNVOVP';
const TEST_PUBLIC_KEY_2 = 'GA2DQGWZTIICWQ7MZ5VZ6CKKXQOGCDHUUFIFO7YUG6SGX63BVG433GZD';

/**
 * Helper to create a mock Express request object
 */
const createMockRequest = (overrides = {}) => ({
  headers: {},
  ...overrides
});

/**
 * Helper to create a mock Express response object
 */
const createMockResponse = () => {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
};

/**
 * Helper to create a mock next function
 */
const createMockNext = () => jest.fn();

beforeAll(async () => {
  // Setup in-memory MongoDB
  mongoServer = await MongoMemoryServer.create();
  const mongoUri = mongoServer.getUri();
  await mongoose.connect(mongoUri);

  // Set test JWT secret
  process.env.JWT_SECRET = 'test-secret-key-for-testing-only';
  process.env.JWT_EXPIRES_IN = '1h';

  // Create test user
  testUser = new User({
    publicKey: TEST_PUBLIC_KEY,
    username: 'testuser'
  });
  await testUser.save();

  // Generate valid token
  validToken = generateToken(TEST_PUBLIC_KEY, 'testuser');

  // Generate expired token
  expiredToken = jwt.sign(
    { publicKey: TEST_PUBLIC_KEY, username: 'testuser', type: 'access' },
    process.env.JWT_SECRET,
    { expiresIn: '-1h', issuer: 'SoroMint', audience: 'SoroMint-API' }
  );

  invalidToken = 'invalid.token.here';
});

afterEach(async () => {
  // Clear users collection
  await User.deleteMany({});
  // Recreate test user
  testUser = new User({
    publicKey: TEST_PUBLIC_KEY,
    username: 'testuser'
  });
  await testUser.save();
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
  delete process.env.JWT_SECRET;
  delete process.env.JWT_EXPIRES_IN;
});

describe('Auth Middleware', () => {
  describe('extractTokenFromHeader', () => {
    it('should extract token from valid Bearer header', () => {
      const req = createMockRequest({
        headers: { authorization: 'Bearer mytoken123' }
      });

      const token = extractTokenFromHeader(req);

      expect(token).toBe('mytoken123');
    });

    it('should return null if no authorization header', () => {
      const req = createMockRequest();

      const token = extractTokenFromHeader(req);

      expect(token).toBeNull();
    });

    it('should return null if header does not start with Bearer', () => {
      const req = createMockRequest({
        headers: { authorization: 'Basic mytoken123' }
      });

      const token = extractTokenFromHeader(req);

      expect(token).toBeNull();
    });

    it('should return null if authorization header is empty', () => {
      const req = createMockRequest({
        headers: { authorization: '' }
      });

      const token = extractTokenFromHeader(req);

      expect(token).toBeNull();
    });

    it('should handle Bearer with no token', () => {
      const req = createMockRequest({
        headers: { authorization: 'Bearer ' }
      });

      const token = extractTokenFromHeader(req);

      expect(token).toBe('');
    });
  });

  describe('generateToken', () => {
    it('should generate a valid JWT token', () => {
      const token = generateToken(TEST_PUBLIC_KEY, 'testuser');

      expect(token).toBeDefined();
      expect(typeof token).toBe('string');
      expect(token.split('.')).toHaveLength(3); // JWT has 3 parts
    });

    it('should include correct payload data', () => {
      const token = generateToken(TEST_PUBLIC_KEY, 'testuser');
      const decoded = jwt.decode(token);

      expect(decoded.publicKey).toBe(TEST_PUBLIC_KEY);
      expect(decoded.username).toBe('testuser');
      expect(decoded.type).toBe('access');
      expect(decoded.iss).toBe('SoroMint');
      expect(decoded.aud).toBe('SoroMint-API');
    });

    it('should work without username', () => {
      const token = generateToken(TEST_PUBLIC_KEY);
      const decoded = jwt.decode(token);

      expect(decoded.publicKey).toBe(TEST_PUBLIC_KEY);
      expect(decoded.username).toBeNull();
    });

    it('should throw error if JWT_SECRET is not configured', () => {
      const originalSecret = process.env.JWT_SECRET;
      delete process.env.JWT_SECRET;

      expect(() => generateToken(TEST_PUBLIC_KEY)).toThrow('JWT_SECRET environment variable is not configured');

      process.env.JWT_SECRET = originalSecret;
    });

    it('should use custom expiration from environment', () => {
      process.env.JWT_EXPIRES_IN = '7d';
      const token = generateToken(TEST_PUBLIC_KEY);
      const decoded = jwt.decode(token);

      expect(decoded.exp).toBeDefined();
      // Token should expire in 7 days
      const now = Math.floor(Date.now() / 1000);
      const sevenDays = 7 * 24 * 60 * 60;
      expect(decoded.exp).toBeGreaterThanOrEqual(now + sevenDays - 10); // 10s buffer

      process.env.JWT_EXPIRES_IN = '1h';
    });
  });

  describe('decodeToken', () => {
    it('should decode a valid token without verification', () => {
      const token = generateToken(TEST_PUBLIC_KEY, 'testuser');
      const decoded = decodeToken(token);

      expect(decoded.publicKey).toBe(TEST_PUBLIC_KEY);
      expect(decoded.username).toBe('testuser');
    });

    it('should return null for invalid token format', () => {
      const decoded = decodeToken('not.a.valid.token');

      expect(decoded).toBeNull();
    });

    it('should return null for empty string', () => {
      const decoded = decodeToken('');

      expect(decoded).toBeNull();
    });

    it('should decode expired tokens', () => {
      const decoded = decodeToken(expiredToken);

      expect(decoded).toBeDefined();
      expect(decoded.publicKey).toBe(TEST_PUBLIC_KEY);
    });
  });

  describe('verifyToken', () => {
    it('should verify a valid token', () => {
      const decoded = verifyToken(validToken);

      expect(decoded.publicKey).toBe(TEST_PUBLIC_KEY);
      expect(decoded.username).toBe('testuser');
    });

    it('should throw error for expired token', () => {
      expect(() => verifyToken(expiredToken)).toThrow('jwt expired');
    });

    it('should throw error for invalid token', () => {
      expect(() => verifyToken(invalidToken)).toThrow('invalid token');
    });

    it('should throw error if JWT_SECRET is not configured', () => {
      const originalSecret = process.env.JWT_SECRET;
      delete process.env.JWT_SECRET;

      expect(() => verifyToken(validToken)).toThrow('JWT_SECRET environment variable is not configured');

      process.env.JWT_SECRET = originalSecret;
    });
  });

  describe('authenticate middleware', () => {
    it('should authenticate valid token and attach user to request', async () => {
      const req = createMockRequest({
        headers: { authorization: `Bearer ${validToken}` }
      });
      const res = createMockResponse();
      const next = createMockNext();

      await authenticate(req, res, next);

      expect(next).toHaveBeenCalledWith();
      expect(req.user).toBeDefined();
      expect(req.user.publicKey).toBe(TEST_PUBLIC_KEY);
      expect(req.token).toBeDefined();
      expect(req.token.publicKey).toBe(TEST_PUBLIC_KEY);
    });

    it('should call next with error if no token provided', async () => {
      const req = createMockRequest();
      const res = createMockResponse();
      const next = createMockNext();

      await authenticate(req, res, next);

      expect(next).toHaveBeenCalledWith(expect.any(AppError));
      const error = next.mock.calls[0][0];
      expect(error.statusCode).toBe(401);
      expect(error.code).toBe('AUTH_REQUIRED');
    });

    it('should call next with error if token is invalid', async () => {
      const req = createMockRequest({
        headers: { authorization: `Bearer ${invalidToken}` }
      });
      const res = createMockResponse();
      const next = createMockNext();

      await authenticate(req, res, next);

      expect(next).toHaveBeenCalledWith(expect.any(AppError));
      const error = next.mock.calls[0][0];
      expect(error.statusCode).toBe(401);
      expect(error.code).toBe('INVALID_TOKEN');
    });

    it('should call next with error if token is expired', async () => {
      const req = createMockRequest({
        headers: { authorization: `Bearer ${expiredToken}` }
      });
      const res = createMockResponse();
      const next = createMockNext();

      await authenticate(req, res, next);

      expect(next).toHaveBeenCalledWith(expect.any(AppError));
      const error = next.mock.calls[0][0];
      expect(error.statusCode).toBe(401);
      expect(error.code).toBe('TOKEN_EXPIRED');
    });

    it('should call next with error if user not found', async () => {
      // Generate token for non-existent user
      const fakeToken = generateToken(TEST_PUBLIC_KEY_2, 'fakeuser');

      const req = createMockRequest({
        headers: { authorization: `Bearer ${fakeToken}` }
      });
      const res = createMockResponse();
      const next = createMockNext();

      await authenticate(req, res, next);

      expect(next).toHaveBeenCalledWith(expect.any(AppError));
      const error = next.mock.calls[0][0];
      expect(error.statusCode).toBe(401);
      expect(error.code).toBe('USER_NOT_FOUND');
    });

    it('should call next with error if account is suspended', async () => {
      // Create suspended user
      const suspendedUser = new User({
        publicKey: TEST_PUBLIC_KEY_2,
        username: 'suspendeduser',
        status: 'suspended'
      });
      await suspendedUser.save();

      const suspendedToken = generateToken(TEST_PUBLIC_KEY_2, 'suspendeduser');

      const req = createMockRequest({
        headers: { authorization: `Bearer ${suspendedToken}` }
      });
      const res = createMockResponse();
      const next = createMockNext();

      await authenticate(req, res, next);

      expect(next).toHaveBeenCalledWith(expect.any(AppError));
      const error = next.mock.calls[0][0];
      expect(error.statusCode).toBe(403);
      expect(error.code).toBe('ACCOUNT_INACTIVE');
    });

    it('should call next with error if account is deleted', async () => {
      const deletedUser = new User({
        publicKey: TEST_PUBLIC_KEY_2,
        username: 'deleteduser',
        status: 'deleted'
      });
      await deletedUser.save();

      const deletedToken = generateToken(TEST_PUBLIC_KEY_2, 'deleteduser');

      const req = createMockRequest({
        headers: { authorization: `Bearer ${deletedToken}` }
      });
      const res = createMockResponse();
      const next = createMockNext();

      await authenticate(req, res, next);

      expect(next).toHaveBeenCalledWith(expect.any(AppError));
      const error = next.mock.calls[0][0];
      expect(error.statusCode).toBe(403);
      expect(error.code).toBe('ACCOUNT_INACTIVE');
    });

    it('should handle malformed Bearer token format', async () => {
      const req = createMockRequest({
        headers: { authorization: 'Bearer' } // Missing space and token
      });
      const res = createMockResponse();
      const next = createMockNext();

      await authenticate(req, res, next);

      expect(next).toHaveBeenCalledWith(expect.any(AppError));
      const error = next.mock.calls[0][0];
      expect(error.statusCode).toBe(401);
    });
  });

  describe('optionalAuthenticate middleware', () => {
    it('should attach user if valid token provided', async () => {
      const req = createMockRequest({
        headers: { authorization: `Bearer ${validToken}` }
      });
      const res = createMockResponse();
      const next = createMockNext();

      await optionalAuthenticate(req, res, next);

      expect(next).toHaveBeenCalledWith();
      expect(req.user).toBeDefined();
      expect(req.user.publicKey).toBe(TEST_PUBLIC_KEY);
    });

    it('should not fail if no token provided', async () => {
      const req = createMockRequest();
      const res = createMockResponse();
      const next = createMockNext();

      await optionalAuthenticate(req, res, next);

      expect(next).toHaveBeenCalledWith();
      expect(req.user).toBeUndefined();
    });

    it('should not fail if invalid token provided', async () => {
      const req = createMockRequest({
        headers: { authorization: `Bearer ${invalidToken}` }
      });
      const res = createMockResponse();
      const next = createMockNext();

      await optionalAuthenticate(req, res, next);

      expect(next).toHaveBeenCalledWith();
      expect(req.user).toBeUndefined();
    });

    it('should not attach user if user not found', async () => {
      const fakeToken = generateToken(TEST_PUBLIC_KEY_2, 'fakeuser');

      const req = createMockRequest({
        headers: { authorization: `Bearer ${fakeToken}` }
      });
      const res = createMockResponse();
      const next = createMockNext();

      await optionalAuthenticate(req, res, next);

      expect(next).toHaveBeenCalledWith();
      expect(req.user).toBeUndefined();
    });

    it('should not attach user if account is suspended', async () => {
      const suspendedUser = new User({
        publicKey: TEST_PUBLIC_KEY_2,
        username: 'suspendeduser',
        status: 'suspended'
      });
      await suspendedUser.save();

      const suspendedToken = generateToken(TEST_PUBLIC_KEY_2, 'suspendeduser');

      const req = createMockRequest({
        headers: { authorization: `Bearer ${suspendedToken}` }
      });
      const res = createMockResponse();
      const next = createMockNext();

      await optionalAuthenticate(req, res, next);

      expect(next).toHaveBeenCalledWith();
      expect(req.user).toBeUndefined();
    });
  });

  describe('authorize middleware', () => {
    it('should allow access if user has required role', async () => {
      const req = createMockRequest({
        user: { publicKey: TEST_PUBLIC_KEY }
      });
      const res = createMockResponse();
      const next = createMockNext();

      const middleware = authorize('user');
      middleware(req, res, next);

      expect(next).toHaveBeenCalledWith();
    });

    it('should allow access if user has admin role', async () => {
      const req = createMockRequest({
        user: { publicKey: TEST_PUBLIC_KEY }
      });
      const res = createMockResponse();
      const next = createMockNext();

      const middleware = authorize('admin');
      middleware(req, res, next);

      expect(next).toHaveBeenCalledWith();
    });

    it('should deny access if no user in request', async () => {
      const req = createMockRequest();
      const res = createMockResponse();
      const next = createMockNext();

      const middleware = authorize('user');
      middleware(req, res, next);

      expect(next).toHaveBeenCalledWith(expect.any(AppError));
      const error = next.mock.calls[0][0];
      expect(error.statusCode).toBe(401);
      expect(error.code).toBe('AUTH_REQUIRED');
    });

    it('should work with multiple roles', async () => {
      const req = createMockRequest({
        user: { publicKey: TEST_PUBLIC_KEY }
      });
      const res = createMockResponse();
      const next = createMockNext();

      const middleware = authorize('user', 'admin', 'moderator');
      middleware(req, res, next);

      expect(next).toHaveBeenCalledWith();
    });
  });
});

describe('Auth Middleware Integration', () => {
  const express = require('express');
  const request = require('supertest');

  let app;

  beforeEach(() => {
    app = express();
    app.use(express.json());
  });

  it('should protect route with authenticate middleware', async () => {
    app.get('/protected', authenticate, (req, res) => {
      res.json({ success: true, user: req.user.publicKey });
    });
    app.use(errorHandler);

    // Without token - should fail
    const response1 = await request(app).get('/protected');
    expect(response1.status).toBe(401);

    // With valid token - should succeed
    const response2 = await request(app)
      .get('/protected')
      .set('Authorization', `Bearer ${validToken}`);
    expect(response2.status).toBe(200);
    expect(response2.body.success).toBe(true);
  });

  it('should allow optional authentication', async () => {
    app.get('/optional', optionalAuthenticate, (req, res) => {
      res.json({
        authenticated: !!req.user,
        publicKey: req.user?.publicKey || null
      });
    });

    // Without token
    const response1 = await request(app).get('/optional');
    expect(response1.status).toBe(200);
    expect(response1.body.authenticated).toBe(false);

    // With valid token
    const response2 = await request(app)
      .get('/optional')
      .set('Authorization', `Bearer ${validToken}`);
    expect(response2.status).toBe(200);
    expect(response2.body.authenticated).toBe(true);
  });

  it('should chain authenticate and authorize middleware', async () => {
    app.get('/admin', authenticate, authorize('admin'), (req, res) => {
      res.json({ success: true, message: 'Admin access granted' });
    });
    app.use(errorHandler);

    const response = await request(app)
      .get('/admin')
      .set('Authorization', `Bearer ${validToken}`);

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
  });
});
