const express = require('express');
const { StrKey } = require('@stellar/stellar-sdk');
const User = require('../models/User');
const { generateToken, authenticate } = require('../middleware/auth');
const { asyncHandler, AppError } = require('../middleware/error-handler');
const { loginRateLimiter } = require('../middleware/rate-limiter');
const {
  generateChallenge,
  verifyChallenge,
  CHALLENGE_WINDOW_SECONDS,
} = require('../services/sep10-challenge-service');

/**
 * @title Authentication Routes
 * @author SoroMint Team
 * @notice Handles user registration and login via a SEP-10 style
 *         Stellar wallet challenge-response mechanism.
 *
 * @dev Auth flow overview:
 *   1. Client calls  GET  /api/auth/challenge?publicKey=G...
 *      └─ Server generates a Stellar transaction signed by the server keypair
 *         and returns the base64-XDR alongside a short-lived challengeToken.
 *
 *   2. Client signs the XDR with Freighter and calls
 *         POST /api/auth/login  { publicKey, challengeToken, signedXDR }
 *      └─ Server verifies both server + client signatures, then issues a JWT.
 *
 * Existing endpoints (register / me / refresh / profile) are unchanged.
 */
const createAuthRouter = ({ authLoginRateLimiter = loginRateLimiter } = {}) => {
  const router = express.Router();

  // ─────────────────────────────────────────────────────────────────────────
  // Helper — validate a Stellar G-address and return the normalised form
  // ─────────────────────────────────────────────────────────────────────────
  const validatePublicKey = (publicKey, fieldName = 'publicKey') => {
    if (!publicKey) {
      throw new AppError(`${fieldName} is required`, 400, 'VALIDATION_ERROR');
    }
    if (!StrKey.isValidEd25519PublicKey(publicKey)) {
      throw new AppError(
        'Invalid Stellar public key format. Must be a valid G-address (Ed25519 public key)',
        400,
        'INVALID_PUBLIC_KEY'
      );
    }
    return publicKey.toUpperCase();
  };

  // =========================================================================
  // GET /api/auth/challenge
  // =========================================================================

  /**
   * @route  GET /api/auth/challenge
   * @description Generate a SEP-10 style Stellar challenge transaction.
   *              The client must sign this XDR with Freighter and submit it
   *              to POST /api/auth/login to prove wallet ownership.
   * @access Public
   *
   * @query  {string} publicKey - Stellar G-address of the authenticating wallet
   *
   * @returns {Object} 200
   *   {
   *     transactionXDR : string,  // base64-encoded server-signed Stellar tx
   *     challengeToken : string,  // opaque token; echo it back on login
   *     expiresAt      : number,  // Unix epoch ms — sign before this time
   *     expiresInSeconds: number, // convenience field
   *     serverPublicKey: string   // server's G-address (for client-side verify)
   *   }
   * @returns {Object} 400 - Missing or malformed public key
   */
  router.get(
    '/challenge',
    asyncHandler(async (req, res) => {
      const rawKey = req.query.publicKey;
      const publicKey = validatePublicKey(rawKey);

      const { transactionXDR, challengeToken, expiresAt, serverPublicKey } =
        generateChallenge(publicKey);

      res.json({
        success: true,
        message:
          'Challenge generated. Sign the transaction with your Stellar wallet.',
        data: {
          transactionXDR,
          challengeToken,
          expiresAt,
          expiresInSeconds: CHALLENGE_WINDOW_SECONDS,
          serverPublicKey,
        },
      });
    })
  );

  // =========================================================================
  // POST /api/auth/register
  // =========================================================================

  /**
   * @route  POST /api/auth/register
   * @description Register a new user with their Stellar public key.
   * @access Public
   *
   * @body {string} publicKey  - Stellar public key (G-address)
   * @body {string} [username] - Optional display name (3-50 chars)
   *
   * @returns {Object} 201 - User record and JWT token
   * @returns {Object} 400 - Validation error
   * @returns {Object} 409 - User already registered
   */
  router.post(
    '/register',
    asyncHandler(async (req, res) => {
      const { username } = req.body;
      const publicKey = validatePublicKey(req.body.publicKey);

      // Prevent duplicate registrations
      const existingUser = await User.findByPublicKey(publicKey);
      if (existingUser) {
        throw new AppError(
          'User with this public key already registered',
          409,
          'USER_EXISTS'
        );
      }

      // Optional username constraints
      if (username && (username.length < 3 || username.length > 50)) {
        throw new AppError(
          'Username must be between 3 and 50 characters',
          400,
          'VALIDATION_ERROR'
        );
      }

      const user = new User({
        publicKey,
        username: username ? username.trim() : undefined,
      });
      await user.save();

      const token = generateToken(publicKey, user.username);

      res.status(201).json({
        success: true,
        message: 'Registration successful',
        data: {
          user: {
            id: user._id,
            publicKey: user.publicKey,
            username: user.username,
            createdAt: user.createdAt,
          },
          token,
          expiresIn: process.env.JWT_EXPIRES_IN || '24h',
        },
      });
    })
  );

  // =========================================================================
  // POST /api/auth/login
  // =========================================================================

  /**
   * @route  POST /api/auth/login
   * @description Authenticate via SEP-10 challenge-response.
   *
   *   The client must:
   *     1. Obtain a challenge via GET /api/auth/challenge?publicKey=<G-addr>
   *     2. Sign the returned `transactionXDR` with Freighter (or any Stellar
   *        wallet) using the matching secret key.
   *     3. Submit this request with the signed XDR + challenge token.
   *
   *   The server verifies:
   *     • The challenge token is known, unused, and not expired.
   *     • The signed XDR contains a valid server signature (tamper proof).
   *     • The signed XDR contains a valid client signature (ownership proof).
   *
   * @access Public (rate-limited)
   *
   * @body {string} publicKey      - Stellar G-address (must match the challenge)
   * @body {string} challengeToken - Token returned by GET /api/auth/challenge
   * @body {string} signedXDR      - base64 XDR of the transaction signed by
   *                                  the client's wallet
   *
   * @returns {Object} 200  - User record and JWT token
   * @returns {Object} 400  - Missing / malformed fields
   * @returns {Object} 401  - Signature verification failed, or user not found
   * @returns {Object} 403  - Account suspended / deleted
   */
  router.post(
    '/login',
    authLoginRateLimiter,
    asyncHandler(async (req, res) => {
      const { challengeToken, signedXDR } = req.body;
      const publicKey = validatePublicKey(req.body.publicKey);

      // ── Require both challenge fields ───────────────────────────────────────
      if (
        !challengeToken ||
        typeof challengeToken !== 'string' ||
        !challengeToken.trim()
      ) {
        throw new AppError(
          'challengeToken is required. First call GET /api/auth/challenge?publicKey=<your-key>',
          400,
          'MISSING_CHALLENGE_TOKEN'
        );
      }

      if (!signedXDR || typeof signedXDR !== 'string' || !signedXDR.trim()) {
        throw new AppError(
          'signedXDR is required. Sign the challenge transaction with your Stellar wallet.',
          400,
          'MISSING_SIGNED_XDR'
        );
      }

      // ── Cryptographic verification ──────────────────────────────────────────
      const result = verifyChallenge(challengeToken.trim(), signedXDR.trim());

      if (!result.valid) {
        throw new AppError(
          `Authentication failed: ${result.error}`,
          401,
          'CHALLENGE_VERIFICATION_FAILED'
        );
      }

      // Extra safety: make sure the verified public key matches the submitted one
      if (result.publicKey !== publicKey) {
        throw new AppError(
          'Public key mismatch between request body and signed challenge.',
          401,
          'PUBLIC_KEY_MISMATCH'
        );
      }

      // ── User look-up ────────────────────────────────────────────────────────
      const user = await User.findByPublicKey(publicKey);
      if (!user) {
        throw new AppError(
          'User not found. Please register first.',
          401,
          'USER_NOT_FOUND'
        );
      }

      // ── Account status ──────────────────────────────────────────────────────
      if (!user.isActive()) {
        throw new AppError(
          `Account is ${user.status}. Please contact support.`,
          403,
          'ACCOUNT_INACTIVE'
        );
      }

      // ── Issue JWT ───────────────────────────────────────────────────────────
      await user.updateLastLogin();
      const token = generateToken(publicKey, user.username);

      res.json({
        success: true,
        message: 'Login successful',
        data: {
          user: {
            id: user._id,
            publicKey: user.publicKey,
            username: user.username,
            lastLoginAt: user.lastLoginAt,
          },
          token,
          expiresIn: process.env.JWT_EXPIRES_IN || '24h',
        },
      });
    })
  );

  // =========================================================================
  // GET /api/auth/me
  // =========================================================================

  /**
   * @route  GET /api/auth/me
   * @description Return the authenticated user's profile.
   * @access Private (requires valid JWT)
   *
   * @header {string} Authorization - Bearer <token>
   *
   * @returns {Object} 200 - User profile
   * @returns {Object} 401 - Invalid / missing token
   */
  router.get(
    '/me',
    authenticate,
    asyncHandler(async (req, res) => {
      res.json({
        success: true,
        data: {
          user: {
            id: req.user._id,
            publicKey: req.user.publicKey,
            username: req.user.username,
            status: req.user.status,
            createdAt: req.user.createdAt,
            lastLoginAt: req.user.lastLoginAt,
          },
        },
      });
    })
  );

  // =========================================================================
  // POST /api/auth/refresh
  // =========================================================================

  /**
   * @route  POST /api/auth/refresh
   * @description Refresh the JWT for the currently authenticated user.
   * @access Private (requires valid JWT)
   *
   * @header {string} Authorization - Bearer <token>
   *
   * @returns {Object} 200 - New JWT
   * @returns {Object} 401 - Invalid / expired token
   */
  router.post(
    '/refresh',
    authenticate,
    asyncHandler(async (req, res) => {
      const newToken = generateToken(req.user.publicKey, req.user.username);

      res.json({
        success: true,
        message: 'Token refreshed successfully',
        data: {
          token: newToken,
          expiresIn: process.env.JWT_EXPIRES_IN || '24h',
        },
      });
    })
  );

  // =========================================================================
  // PUT /api/auth/profile
  // =========================================================================

  /**
   * @route  PUT /api/auth/profile
   * @description Update the authenticated user's profile.
   * @access Private (requires valid JWT)
   *
   * @header {string} Authorization - Bearer <token>
   * @body   {string} [username]    - New display name (3-50 chars)
   *
   * @returns {Object} 200 - Updated user profile
   * @returns {Object} 400 - Validation error
   */
  router.put(
    '/profile',
    authenticate,
    asyncHandler(async (req, res) => {
      const { username } = req.body;

      if (username !== undefined) {
        if (username.length < 3 || username.length > 50) {
          throw new AppError(
            'Username must be between 3 and 50 characters',
            400,
            'VALIDATION_ERROR'
          );
        }
        req.user.username = username.trim();
      }

      await req.user.save();

      res.json({
        success: true,
        message: 'Profile updated successfully',
        data: {
          user: {
            id: req.user._id,
            publicKey: req.user.publicKey,
            username: req.user.username,
            status: req.user.status,
            lastLoginAt: req.user.lastLoginAt,
          },
        },
      });
    })
  );

  return router;
};

module.exports = createAuthRouter();
module.exports.createAuthRouter = createAuthRouter;
