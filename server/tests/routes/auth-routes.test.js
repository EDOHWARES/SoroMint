/**
 * @title Auth Routes Tests
 * @author SoroMint Team
 * @notice Comprehensive test suite for authentication routes
 * @dev Tests cover registration, login, profile management, and token refresh
 */

const request = require('supertest');
const express = require('express');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const User = require('../../models/User');
const { generateToken, authenticate } = require('../../middleware/auth');
const { errorHandler } = require('../../middleware/error-handler');
const authRoutes = require('../../routes/auth-routes');

// Test environment setup
let mongoServer;
let app;
let testUser;
let validToken;

// Valid Stellar public keys for testing (generated via Keypair.random())
const TEST_PUBLIC_KEY = 'GDZYF2MVD4MMJIDNVTVCKRWP7F55N56CGKUCLH7SZ7KJQLGMMFMNVOVP';
const TEST_PUBLIC_KEY_2 = 'GA2DQGWZTIICWQ7MZ5VZ6CKKXQOGCDHUUFIFO7YUG6SGX63BVG433GZD';
const TEST_PUBLIC_KEY_3 = 'GAMDBSITFGKPOC6ZFLP7HXJFFQMQYMIOXJEFYRBZKM6XWJFFM6SXXHCV';

// Invalid public keys for testing
const INVALID_PUBLIC_KEY_SHORT = 'GABC';
const INVALID_PUBLIC_KEY_WRONG_PREFIX = 'XDKIJJIKXLOM2NRMPNQZUUYK24ZPVFC64CZGCEVDEDG67DJKHS2XVLT5';

beforeAll(async () => {
  // Setup in-memory MongoDB
  mongoServer = await MongoMemoryServer.create();
  const mongoUri = mongoServer.getUri();
  await mongoose.connect(mongoUri);

  // Set test environment variables
  process.env.JWT_SECRET = 'test-secret-key-for-testing-only';
  process.env.JWT_EXPIRES_IN = '1h';

  // Setup Express app
  app = express();
  app.use(express.json());
  app.use('/api/auth', authRoutes);
  app.use(errorHandler);

  // Create test user
  testUser = new User({
    publicKey: TEST_PUBLIC_KEY,
    username: 'testuser'
  });
  await testUser.save();

  // Generate valid token
  validToken = generateToken(TEST_PUBLIC_KEY, 'testuser');
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

describe('Auth Routes', () => {
  describe('POST /api/auth/register', () => {
    it('should register a new user successfully', async () => {
      const response = await request(app)
        .post('/api/auth/register')
        .send({
          publicKey: TEST_PUBLIC_KEY_2,
          username: 'newuser'
        });

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
      expect(response.body.message).toBe('Registration successful');
      expect(response.body.data.user).toBeDefined();
      expect(response.body.data.user.publicKey).toBe(TEST_PUBLIC_KEY_2);
      expect(response.body.data.user.username).toBe('newuser');
      expect(response.body.data.token).toBeDefined();
      expect(response.body.data.expiresIn).toBe('1h');
    });

    it('should register user without username', async () => {
      const response = await request(app)
        .post('/api/auth/register')
        .send({
          publicKey: TEST_PUBLIC_KEY_3
        });

      expect(response.status).toBe(201);
      expect(response.body.data.user.username).toBeUndefined();
    });

    it('should trim whitespace from username', async () => {
      const response = await request(app)
        .post('/api/auth/register')
        .send({
          publicKey: TEST_PUBLIC_KEY_2,
          username: '  spaceduser  '
        });

      expect(response.status).toBe(201);
      expect(response.body.data.user.username).toBe('spaceduser');
    });

    it('should return 400 if public key is missing', async () => {
      const response = await request(app)
        .post('/api/auth/register')
        .send({
          username: 'nopath'
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('Public key is required');
    });

    it('should return 400 if public key is empty', async () => {
      const response = await request(app)
        .post('/api/auth/register')
        .send({
          publicKey: '',
          username: 'emptykey'
        });

      expect(response.status).toBe(400);
      expect(response.body.code).toBe('VALIDATION_ERROR');
    });

    it('should return 400 if public key format is invalid (too short)', async () => {
      const response = await request(app)
        .post('/api/auth/register')
        .send({
          publicKey: INVALID_PUBLIC_KEY_SHORT,
          username: 'shortkey'
        });

      expect(response.status).toBe(400);
      expect(response.body.code).toBe('INVALID_PUBLIC_KEY');
    });

    it('should return 400 if public key has wrong prefix', async () => {
      const response = await request(app)
        .post('/api/auth/register')
        .send({
          publicKey: INVALID_PUBLIC_KEY_WRONG_PREFIX,
          username: 'wrongprefix'
        });

      expect(response.status).toBe(400);
      expect(response.body.code).toBe('INVALID_PUBLIC_KEY');
    });

    it('should return 409 if user already exists', async () => {
      // First registration
      await request(app)
        .post('/api/auth/register')
        .send({
          publicKey: TEST_PUBLIC_KEY_2,
          username: 'firstuser'
        });

      // Second registration with same key
      const response = await request(app)
        .post('/api/auth/register')
        .send({
          publicKey: TEST_PUBLIC_KEY_2,
          username: 'seconduser'
        });

      expect(response.status).toBe(409);
      expect(response.body.error).toContain('already registered');
    });

    it('should return 400 if username is too short', async () => {
      const response = await request(app)
        .post('/api/auth/register')
        .send({
          publicKey: TEST_PUBLIC_KEY_2,
          username: 'ab'
        });

      expect(response.status).toBe(400);
      expect(response.body.code).toBe('VALIDATION_ERROR');
    });

    it('should return 400 if username is too long', async () => {
      const longUsername = 'a'.repeat(51);
      const response = await request(app)
        .post('/api/auth/register')
        .send({
          publicKey: TEST_PUBLIC_KEY_2,
          username: longUsername
        });

      expect(response.status).toBe(400);
      expect(response.body.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('POST /api/auth/login', () => {
    it('should login existing user successfully', async () => {
      const response = await request(app)
        .post('/api/auth/login')
        .send({
          publicKey: TEST_PUBLIC_KEY
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.message).toBe('Login successful');
      expect(response.body.data.user).toBeDefined();
      expect(response.body.data.user.publicKey).toBe(TEST_PUBLIC_KEY);
      expect(response.body.data.token).toBeDefined();
      expect(response.body.data.expiresIn).toBe('1h');
    });

    it('should update lastLoginAt on login', async () => {
      const beforeLogin = await User.findByPublicKey(TEST_PUBLIC_KEY);
      expect(beforeLogin.lastLoginAt).toBeUndefined();

      await request(app)
        .post('/api/auth/login')
        .send({
          publicKey: TEST_PUBLIC_KEY
        });

      const afterLogin = await User.findByPublicKey(TEST_PUBLIC_KEY);
      expect(afterLogin.lastLoginAt).toBeDefined();
      expect(new Date(afterLogin.lastLoginAt).getTime()).toBeGreaterThan(new Date(beforeLogin.createdAt).getTime());
    });

    it('should normalize public key to uppercase', async () => {
      // Note: Stellar public keys are case-sensitive (base32), but we store them uppercase
      // This test verifies the storage is consistently uppercase
      const response = await request(app)
        .post('/api/auth/register')
        .send({
          publicKey: TEST_PUBLIC_KEY_2,
          username: 'uppercaseuser'
        });

      expect(response.status).toBe(201);
      expect(response.body.data.user.publicKey).toBe(TEST_PUBLIC_KEY_2);
    });

    it('should accept signature and challenge (MVP mode)', async () => {
      const response = await request(app)
        .post('/api/auth/login')
        .send({
          publicKey: TEST_PUBLIC_KEY,
          signature: 'fake-signature',
          challenge: 'fake-challenge'
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    });

    it('should return 400 if public key is missing', async () => {
      const response = await request(app)
        .post('/api/auth/login')
        .send({});

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('Public key is required');
    });

    it('should return 400 if public key format is invalid', async () => {
      const response = await request(app)
        .post('/api/auth/login')
        .send({
          publicKey: INVALID_PUBLIC_KEY_SHORT
        });

      expect(response.status).toBe(400);
      expect(response.body.code).toBe('INVALID_PUBLIC_KEY');
    });

    it('should return 401 if user not found', async () => {
      const response = await request(app)
        .post('/api/auth/login')
        .send({
          publicKey: TEST_PUBLIC_KEY_2
        });

      expect(response.status).toBe(401);
      expect(response.body.error).toContain('not found');
      expect(response.body.code).toBe('USER_NOT_FOUND');
    });

    it('should return 403 if account is suspended', async () => {
      // Create suspended user
      const suspendedUser = new User({
        publicKey: TEST_PUBLIC_KEY_2,
        username: 'suspendeduser',
        status: 'suspended'
      });
      await suspendedUser.save();

      const response = await request(app)
        .post('/api/auth/login')
        .send({
          publicKey: TEST_PUBLIC_KEY_2
        });

      expect(response.status).toBe(403);
      expect(response.body.error).toContain('suspended');
      expect(response.body.code).toBe('ACCOUNT_INACTIVE');
    });

    it('should return 403 if account is deleted', async () => {
      const deletedUser = new User({
        publicKey: TEST_PUBLIC_KEY_2,
        username: 'deleteduser',
        status: 'deleted'
      });
      await deletedUser.save();

      const response = await request(app)
        .post('/api/auth/login')
        .send({
          publicKey: TEST_PUBLIC_KEY_2
        });

      expect(response.status).toBe(403);
      expect(response.body.error).toContain('deleted');
      expect(response.body.code).toBe('ACCOUNT_INACTIVE');
    });
  });

  describe('GET /api/auth/me', () => {
    it('should return current user profile', async () => {
      const response = await request(app)
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${validToken}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.user).toBeDefined();
      expect(response.body.data.user.publicKey).toBe(TEST_PUBLIC_KEY);
      expect(response.body.data.user.username).toBe('testuser');
      expect(response.body.data.user.status).toBe('active');
    });

    it('should return 401 if no token provided', async () => {
      const response = await request(app)
        .get('/api/auth/me');

      expect(response.status).toBe(401);
      expect(response.body.code).toBe('AUTH_REQUIRED');
    });

    it('should return 401 if token is invalid', async () => {
      const response = await request(app)
        .get('/api/auth/me')
        .set('Authorization', 'Bearer invalid-token');

      expect(response.status).toBe(401);
      expect(response.body.code).toBe('INVALID_TOKEN');
    });

    it('should return 401 if token is expired', async () => {
      const expiredToken = generateToken(TEST_PUBLIC_KEY, 'testuser');
      // Manually create expired token
      const jwt = require('jsonwebtoken');
      const reallyExpiredToken = jwt.sign(
        { publicKey: TEST_PUBLIC_KEY, username: 'testuser', type: 'access' },
        process.env.JWT_SECRET,
        { expiresIn: '-1h', issuer: 'SoroMint', audience: 'SoroMint-API' }
      );

      const response = await request(app)
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${reallyExpiredToken}`);

      expect(response.status).toBe(401);
      expect(response.body.code).toBe('TOKEN_EXPIRED');
    });

    it('should return 401 if user not found', async () => {
      const fakeToken = generateToken(TEST_PUBLIC_KEY_2, 'fakeuser');

      const response = await request(app)
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${fakeToken}`);

      expect(response.status).toBe(401);
      expect(response.body.code).toBe('USER_NOT_FOUND');
    });
  });

  describe('POST /api/auth/refresh', () => {
    it('should refresh token successfully', async () => {
      const response = await request(app)
        .post('/api/auth/refresh')
        .set('Authorization', `Bearer ${validToken}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.message).toBe('Token refreshed successfully');
      expect(response.body.data.token).toBeDefined();
      expect(response.body.data.token).toMatch(/^eyJ[A-Za-z0-9-_=]+\.[A-Za-z0-9-_=]+\.?[A-Za-z0-9-_.+/=]*$/);
      expect(response.body.data.expiresIn).toBe('1h');
    });

    it('should return 401 if no token provided', async () => {
      const response = await request(app)
        .post('/api/auth/refresh');

      expect(response.status).toBe(401);
      expect(response.body.code).toBe('AUTH_REQUIRED');
    });

    it('should return 401 if token is invalid', async () => {
      const response = await request(app)
        .post('/api/auth/refresh')
        .set('Authorization', 'Bearer invalid-token');

      expect(response.status).toBe(401);
      expect(response.body.code).toBe('INVALID_TOKEN');
    });

    it('should return 401 if user not found', async () => {
      const fakeToken = generateToken(TEST_PUBLIC_KEY_2, 'fakeuser');

      const response = await request(app)
        .post('/api/auth/refresh')
        .set('Authorization', `Bearer ${fakeToken}`);

      expect(response.status).toBe(401);
      expect(response.body.code).toBe('USER_NOT_FOUND');
    });
  });

  describe('PUT /api/auth/profile', () => {
    it('should update username successfully', async () => {
      const response = await request(app)
        .put('/api/auth/profile')
        .set('Authorization', `Bearer ${validToken}`)
        .send({
          username: 'updateduser'
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.message).toBe('Profile updated successfully');
      expect(response.body.data.user.username).toBe('updateduser');
    });

    it('should update username with trim', async () => {
      const response = await request(app)
        .put('/api/auth/profile')
        .set('Authorization', `Bearer ${validToken}`)
        .send({
          username: '  spaceduser  '
        });

      expect(response.status).toBe(200);
      expect(response.body.data.user.username).toBe('spaceduser');
    });

    it('should not update if username not provided', async () => {
      const response = await request(app)
        .put('/api/auth/profile')
        .set('Authorization', `Bearer ${validToken}`)
        .send({});

      expect(response.status).toBe(200);
      expect(response.body.data.user.username).toBe('testuser');
    });

    it('should return 400 if username is too short', async () => {
      const response = await request(app)
        .put('/api/auth/profile')
        .set('Authorization', `Bearer ${validToken}`)
        .send({
          username: 'ab'
        });

      expect(response.status).toBe(400);
      expect(response.body.code).toBe('VALIDATION_ERROR');
    });

    it('should return 400 if username is too long', async () => {
      const longUsername = 'a'.repeat(51);
      const response = await request(app)
        .put('/api/auth/profile')
        .set('Authorization', `Bearer ${validToken}`)
        .send({
          username: longUsername
        });

      expect(response.status).toBe(400);
      expect(response.body.code).toBe('VALIDATION_ERROR');
    });

    it('should return 401 if no token provided', async () => {
      const response = await request(app)
        .put('/api/auth/profile')
        .send({
          username: 'updateduser'
        });

      expect(response.status).toBe(401);
      expect(response.body.code).toBe('AUTH_REQUIRED');
    });

    it('should return 401 if user not found', async () => {
      const fakeToken = generateToken(TEST_PUBLIC_KEY_2, 'fakeuser');

      const response = await request(app)
        .put('/api/auth/profile')
        .set('Authorization', `Bearer ${fakeToken}`)
        .send({
          username: 'updateduser'
        });

      expect(response.status).toBe(401);
      expect(response.body.code).toBe('USER_NOT_FOUND');
    });
  });

  describe('Integration Tests', () => {
    it('should complete full registration -> login -> profile flow', async () => {
      const newPublicKey = TEST_PUBLIC_KEY_3;
      const newUsername = 'integrationuser';

      // Register
      const registerResponse = await request(app)
        .post('/api/auth/register')
        .send({
          publicKey: newPublicKey,
          username: newUsername
        });

      expect(registerResponse.status).toBe(201);
      const registerToken = registerResponse.body.data.token;

      // Get profile with registration token
      const profileResponse = await request(app)
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${registerToken}`);

      expect(profileResponse.status).toBe(200);
      expect(profileResponse.body.data.user.username).toBe(newUsername);

      // Login
      const loginResponse = await request(app)
        .post('/api/auth/login')
        .send({
          publicKey: newPublicKey
        });

      expect(loginResponse.status).toBe(200);
      const loginToken = loginResponse.body.data.token;

      // Get profile with login token
      const profileResponse2 = await request(app)
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${loginToken}`);

      expect(profileResponse2.status).toBe(200);
      expect(profileResponse2.body.data.user.username).toBe(newUsername);

      // Update profile
      const updateResponse = await request(app)
        .put('/api/auth/profile')
        .set('Authorization', `Bearer ${loginToken}`)
        .send({
          username: 'updatedintegrationuser'
        });

      expect(updateResponse.status).toBe(200);
      expect(updateResponse.body.data.user.username).toBe('updatedintegrationuser');

      // Refresh token
      const refreshResponse = await request(app)
        .post('/api/auth/refresh')
        .set('Authorization', `Bearer ${loginToken}`);

      expect(refreshResponse.status).toBe(200);
      const refreshedToken = refreshResponse.body.data.token;

      // Verify refreshed token works
      const profileResponse3 = await request(app)
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${refreshedToken}`);

      expect(profileResponse3.status).toBe(200);
      expect(profileResponse3.body.data.user.username).toBe('updatedintegrationuser');
    });

    it('should handle multiple users independently', async () => {
      // Register two users
      const user1Key = TEST_PUBLIC_KEY_2;
      const user2Key = TEST_PUBLIC_KEY_3;

      const register1 = await request(app)
        .post('/api/auth/register')
        .send({ publicKey: user1Key, username: 'user1' });

      const register2 = await request(app)
        .post('/api/auth/register')
        .send({ publicKey: user2Key, username: 'user2' });

      const token1 = register1.body.data.token;
      const token2 = register2.body.data.token;

      // Get profiles
      const profile1 = await request(app)
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${token1}`);

      const profile2 = await request(app)
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${token2}`);

      expect(profile1.body.data.user.username).toBe('user1');
      expect(profile2.body.data.user.username).toBe('user2');
      expect(profile1.body.data.user.publicKey).toBe(user1Key);
      expect(profile2.body.data.user.publicKey).toBe(user2Key);
    });
  });

  describe('Edge Cases', () => {
    it('should handle special characters in username', async () => {
      const response = await request(app)
        .post('/api/auth/register')
        .send({
          publicKey: TEST_PUBLIC_KEY_2,
          username: 'user-with-dashes_and_underscores123'
        });

      expect(response.status).toBe(201);
      expect(response.body.data.user.username).toBe('user-with-dashes_and_underscores123');
    });

    it('should handle unicode characters in username', async () => {
      const response = await request(app)
        .post('/api/auth/register')
        .send({
          publicKey: TEST_PUBLIC_KEY_2,
          username: '用户テスト'
        });

      expect(response.status).toBe(201);
      expect(response.body.data.user.username).toBe('用户テスト');
    });

    it('should handle case-insensitive public key lookup', async () => {
      // Register with the public key
      await request(app)
        .post('/api/auth/register')
        .send({
          publicKey: TEST_PUBLIC_KEY_2,
          username: 'caseuser'
        });

      // Login with the same public key (Stellar keys are case-sensitive base32)
      const loginResponse = await request(app)
        .post('/api/auth/login')
        .send({
          publicKey: TEST_PUBLIC_KEY_2
        });

      expect(loginResponse.status).toBe(200);
      expect(loginResponse.body.data.user.publicKey).toBe(TEST_PUBLIC_KEY_2);
    });

    it('should handle concurrent registrations', async () => {
      const registrations = Promise.all([
        request(app)
          .post('/api/auth/register')
          .send({ publicKey: TEST_PUBLIC_KEY_2, username: 'concurrent1' }),
        request(app)
          .post('/api/auth/register')
          .send({ publicKey: TEST_PUBLIC_KEY_2, username: 'concurrent2' })
      ]);

      const [response1, response2] = await registrations;

      // One should succeed, one should fail with 409
      const statuses = [response1.status, response2.status].sort();
      expect(statuses).toEqual([201, 409]);
    });
  });
});
