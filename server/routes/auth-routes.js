'use strict';

const express = require('express');
const { StrKey } = require('@stellar/stellar-sdk');
const User = require('../models/User');
const passport = require('passport');
const { generateToken, authenticate, optionalAuthenticate } = require('../middleware/auth');
const { asyncHandler, AppError } = require('../middleware/error-handler');
const { loginRateLimiter } = require('../middleware/rate-limiter');
const {
  generateChallenge,
  verifyChallenge,
  CHALLENGE_WINDOW_SECONDS,
} = require('../services/sep10-challenge-service');

/**
 * @title Authentication Routes
 * @notice SEP-10 style Stellar wallet challenge-response authentication
 * @dev Auth flow: GET /challenge → POST /login → JWT issued
 */
const createAuthRouter = ({ authLoginRateLimiter = loginRateLimiter } = {}) => {
  const router = express.Router();

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

  /**
   * @openapi
   * @route POST /api/auth/register
   * @name register
   * @description Register a new user with their Stellar public key
   * @tags Auth
   * @param {string} publicKey - Stellar G-address
   * @param {string} username - Optional display name (3-50 chars)
   * @param {string} referralCode - Optional referral code (optional)
   * @returns {object} 201 - User created with JWT
   * @returns {object} 400 - Validation error
   * @returns {object} 409 - User already registered
   */
  router.post(
    '/register',
    asyncHandler(async (req, res) => {
      const { username, referralCode } = req.body;
      const publicKey = validatePublicKey(req.body.publicKey);

      const existingUser = await User.findByPublicKey(publicKey);
      if (existingUser) {
        throw new AppError(
          'User with this public key already registered',
          409,
          'USER_EXISTS'
        );
      }

      let referrer = null;
      if (referralCode) {
        referrer = await User.findOne({ referralCode: referralCode.trim().toUpperCase() });
        if (!referrer) {
          logger.warn('Invalid referral code provided during registration', { referralCode });
        }
      }

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
        referredBy: referrer ? referrer._id : null,
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
            referralCode: user.referralCode,
            createdAt: user.createdAt,
          },
          token,
          expiresIn: process.env.JWT_EXPIRES_IN || '24h',
        },
      });
    })
  );

  /**
   * @openapi
   * @route GET /api/auth/challenge
   * @name generateChallenge
   * @description Generate a SEP-10 Stellar challenge transaction for wallet authentication
   * @tags Auth
   * @param {string} publicKey - Stellar G-address of authenticating wallet
   * @returns {object} 200 - Challenge transaction XDR and token
   * @returns {object} 400 - Missing or malformed public key
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

  /**
   * @openapi
   * @route POST /api/auth/login
   * @name login
   * @description Authenticate via SEP-10 challenge-response. First call GET /challenge, then sign the XDR with Freighter.
   * @tags Auth
   * @param {string} publicKey - Stellar G-address (must match challenge)
   * @param {string} challengeToken - Token returned by GET /api/auth/challenge
   * @param {string} signedXDR - base64 XDR of the transaction signed by wallet
   * @returns {object} 200 - User profile and JWT token
   * @returns {object} 400 - Missing challengeToken or signedXDR
   * @returns {object} 401 - Signature verification failed or user not found
   * @returns {object} 403 - Account suspended
   */
  router.post(
    '/login',
    authLoginRateLimiter,
    asyncHandler(async (req, res) => {
      const { challengeToken, signedXDR } = req.body;
      const publicKey = validatePublicKey(req.body.publicKey);

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

      const result = verifyChallenge(challengeToken.trim(), signedXDR.trim());

      if (!result.valid) {
        throw new AppError(
          `Authentication failed: ${result.error}`,
          401,
          'CHALLENGE_VERIFICATION_FAILED'
        );
      }

      if (result.publicKey !== publicKey) {
        throw new AppError(
          'Public key mismatch between request body and signed challenge.',
          401,
          'PUBLIC_KEY_MISMATCH'
        );
      }

      const user = await User.findByPublicKey(publicKey);
      if (!user) {
        throw new AppError(
          'User not found. Please register first.',
          401,
          'USER_NOT_FOUND'
        );
      }

      if (!user.isActive()) {
        throw new AppError(
          `Account is ${user.status}. Please contact support.`,
          403,
          'ACCOUNT_INACTIVE'
        );
      }

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

  /**
   * @openapi
   * @route GET /api/auth/me
   * @name getMe
   * @description Return the authenticated user's profile
   * @tags Auth
   * @security BearerAuth
   * @returns {object} 200 - User profile
   * @returns {object} 401 - Invalid or missing token
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

  /**
   * @openapi
   * @route POST /api/auth/refresh
   * @name refreshToken
   * @description Refresh the JWT for the currently authenticated user
   * @tags Auth
   * @security BearerAuth
   * @returns {object} 200 - New JWT token
   * @returns {object} 401 - Invalid or expired token
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

  /**
   * @openapi
   * @route PUT /api/auth/profile
   * @name updateProfile
   * @description Update the authenticated user's profile
   * @tags Auth
   * @security BearerAuth
   * @param {string} username - New display name (3-50 chars, optional)
   * @returns {object} 200 - Updated user profile
   * @returns {object} 400 - Validation error
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

  /**
   * @openapi
   * @route GET /api/auth/google
   * @name googleAuth
   * @description Initiate Google OAuth2 flow
   * @tags Auth
   * @param {string} link - Pass 'link' to link to existing account instead of login
   */
  router.get('/google', optionalAuthenticate, (req, res, next) => {
    const state = req.query.link ? 'link' : 'login';
    passport.authenticate('google', {
      scope: ['profile', 'email'],
      state,
    })(req, res, next);
  });

  /**
   * @openapi
   * @route GET /api/auth/google/callback
   * @name googleCallback
   * @description Google OAuth2 callback handler
   * @tags Auth
   */
  router.get(
    '/google/callback',
    passport.authenticate('google', { failureRedirect: '/login', session: false }),
    (req, res) => {
      const token = generateToken(req.user);
      res.json({
        success: true,
        data: {
          user: req.user,
          token,
        },
      });
    }
  );

  /**
   * @openapi
   * @route GET /api/auth/github
   * @name githubAuth
   * @description Initiate GitHub OAuth2 flow
   * @tags Auth
   */
  router.get('/github', optionalAuthenticate, (req, res, next) => {
    passport.authenticate('github', { scope: ['user:email'] })(req, res, next);
  });

  /**
   * @openapi
   * @route GET /api/auth/github/callback
   * @name githubCallback
   * @description GitHub OAuth2 callback handler
   * @tags Auth
   */
  router.get(
    '/github/callback',
    passport.authenticate('github', { failureRedirect: '/login', session: false }),
    (req, res) => {
      const token = generateToken(req.user);
      res.json({
        success: true,
        data: {
          user: req.user,
          token,
        },
      });
    }
  );

  /**
   * @openapi
   * @route POST /api/auth/link-stellar
   * @name linkStellar
   * @description Link a Stellar public key to a social login account
   * @tags Auth
   * @security BearerAuth
   * @param {string} publicKey - Valid Stellar G-address to link
   * @returns {object} 200 - Wallet linked successfully
   * @returns {object} 400 - Invalid public key
   * @returns {object} 409 - Public key already linked to another account
   */
  router.post(
    '/link-stellar',
    authenticate,
    asyncHandler(async (req, res) => {
      const { publicKey } = req.body;

      if (!publicKey || !StrKey.isValidEd25519PublicKey(publicKey)) {
        throw new AppError('Valid Stellar public key is required', 400, 'INVALID_PUBLIC_KEY');
      }

      const normalizedPublicKey = publicKey.toUpperCase();

      const existingUser = await User.findOne({ publicKey: normalizedPublicKey });
      if (existingUser && existingUser._id.toString() !== req.user._id.toString()) {
        throw new AppError('This Stellar public key is already linked to another account', 409, 'KEY_ALREADY_LINKED');
      }

      req.user.publicKey = normalizedPublicKey;
      await req.user.save();

      res.json({
        success: true,
        message: 'Stellar wallet linked successfully',
        data: {
          user: {
            id: req.user._id,
            publicKey: req.user.publicKey,
            username: req.user.username,
          },
        },
      });
    })
  );

  return router;
};

module.exports = createAuthRouter();
module.exports.createAuthRouter = createAuthRouter;
