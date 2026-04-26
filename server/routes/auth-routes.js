const express = require('express');
const { StrKey } = require('@stellar/stellar-sdk');
const User = require('../models/User');
const RefreshToken = require('../models/RefreshToken');
const passport = require('passport');
const { generateAccessToken, generateRefreshToken, verifyRefreshToken, authenticate, optionalAuthenticate } = require('../middleware/auth');
const { asyncHandler, AppError } = require('../middleware/error-handler');
const { loginRateLimiter } = require('../middleware/rate-limiter');
const {
  generateChallenge,
  verifyChallenge,
  CHALLENGE_WINDOW_SECONDS,
} = require('../services/sep10-challenge-service');

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

  router.post(
    '/register',
    asyncHandler(async (req, res) => {
      const { publicKey, username } = req.body;

      if (!publicKey) {
        throw new AppError(
          'Public key is required for registration',
          400,
          'VALIDATION_ERROR'
        );
      }

      if (!StrKey.isValidEd25519PublicKey(publicKey)) {
        throw new AppError(
          'Invalid Stellar public key format. Must be a valid G-address (Ed25519 public key)',
          400,
          'INVALID_PUBLIC_KEY'
        );
      }

      const normalizedPublicKey = publicKey.toUpperCase();

      const existingUser = await User.findByPublicKey(normalizedPublicKey);
      if (existingUser) {
        throw new AppError(
          'User with this public key already registered',
          409,
          'USER_EXISTS'
        );
      }

      if (username && (username.length < 3 || username.length > 50)) {
        throw new AppError(
          'Username must be between 3 and 50 characters',
          400,
          'VALIDATION_ERROR'
        );
      }

      const user = new User({
        publicKey: normalizedPublicKey,
        username: username ? username.trim() : undefined,
      });

      await user.save();

      const accessToken = generateAccessToken(user);
      const refreshTokenDoc = await RefreshToken.createRefreshToken(user, {
        userAgent: req.headers['user-agent'],
        ipAddress: req.ip
      });
      const refreshToken = refreshTokenDoc.token;

      res.status(201).json({
        success: true,
        message: 'Registration successful',
        data: {
          user: {
            id: user._id,
            publicKey: user.publicKey,
            username: user.username,
            createdAt: user.createdAt
          },
          accessToken,
          refreshToken,
          expiresIn: process.env.ACCESS_TOKEN_EXPIRES_IN || '15m',
          refreshTokenExpiresIn: process.env.REFRESH_TOKEN_EXPIRES_IN || '7d'
        }
      });
    })
  );

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

  router.post(
    '/login',
    authLoginRateLimiter,
    asyncHandler(async (req, res) => {
      const { publicKey, signature, challenge } = req.body;

      if (!publicKey) {
        throw new AppError(
          'Public key is required for login',
          400,
          'VALIDATION_ERROR'
        );
      }

      if (!StrKey.isValidEd25519PublicKey(publicKey)) {
        throw new AppError(
          'Invalid Stellar public key format. Must be a valid G-address (Ed25519 public key)',
          400,
          'INVALID_PUBLIC_KEY'
        );
      }

      const normalizedPublicKey = publicKey.toUpperCase();

      const user = await User.findByPublicKey(normalizedPublicKey);

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

      if (signature && challenge) {
        console.log(
          '[Login] Signature/challenge provided but not yet validated (MVP mode)'
        );
      }

      await user.updateLastLogin();

      const accessToken = generateAccessToken(user);
      const refreshTokenDoc = await RefreshToken.createRefreshToken(user, {
        userAgent: req.headers['user-agent'],
        ipAddress: req.ip
      });
      const refreshToken = refreshTokenDoc.token;

      res.json({
        success: true,
        message: 'Login successful',
        data: {
          user: {
            id: user._id,
            publicKey: user.publicKey,
            username: user.username,
            lastLoginAt: user.lastLoginAt
          },
          accessToken,
          refreshToken,
          expiresIn: process.env.ACCESS_TOKEN_EXPIRES_IN || '15m',
          refreshTokenExpiresIn: process.env.REFRESH_TOKEN_EXPIRES_IN || '7d'
        }
      });
    })
  );

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
      
      const accessToken = generateAccessToken(user);
      const refreshTokenDoc = await RefreshToken.createRefreshToken(user, {
        userAgent: req.headers['user-agent'],
        ipAddress: req.ip
      });
      const refreshToken = refreshTokenDoc.token;

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
          accessToken,
          refreshToken,
          expiresIn: process.env.ACCESS_TOKEN_EXPIRES_IN || '15m',
          refreshTokenExpiresIn: process.env.REFRESH_TOKEN_EXPIRES_IN || '7d',
        },
      });
    })
  );

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

  router.post('/refresh', asyncHandler(async (req, res) => {
    const { refreshToken } = req.body;
    
    if (!refreshToken) {
      throw new AppError('Refresh token is required', 400, 'REFRESH_TOKEN_REQUIRED');
    }
    
    const { user } = await verifyRefreshToken(refreshToken);
    
    const accessToken = generateAccessToken(user);
    const newRefreshTokenDoc = await RefreshToken.createRefreshToken(user, {
      userAgent: req.headers['user-agent'],
      ipAddress: req.ip
    });
    
    res.json({
      success: true,
      message: 'Token refreshed successfully',
      data: {
        accessToken,
        refreshToken: newRefreshTokenDoc.token,
        expiresIn: process.env.ACCESS_TOKEN_EXPIRES_IN || '15m',
        refreshTokenExpiresIn: process.env.REFRESH_TOKEN_EXPIRES_IN || '7d',
      },
    });
  }));

  router.post(
    '/rotate',
    asyncHandler(async (req, res) => {
      const { refreshToken } = req.body;
      
      if (!refreshToken) {
        throw new AppError('Refresh token is required', 400, 'REFRESH_TOKEN_REQUIRED');
      }
      
      const { user } = await verifyRefreshToken(refreshToken);
      
      const accessToken = generateAccessToken(user);
      const newRefreshTokenDoc = await RefreshToken.createRefreshToken(user, {
        userAgent: req.headers['user-agent'],
        ipAddress: req.ip
      });
      
      res.json({
        success: true,
        message: 'Token rotated successfully',
        data: {
          accessToken,
          refreshToken: newRefreshTokenDoc.token,
          expiresIn: process.env.ACCESS_TOKEN_EXPIRES_IN || '15m',
          refreshTokenExpiresIn: process.env.REFRESH_TOKEN_EXPIRES_IN || '7d',
        },
      });
    })
  );

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

  router.get('/google', optionalAuthenticate, (req, res, next) => {
    const state = req.query.link ? 'link' : 'login';
    passport.authenticate('google', {
      scope: ['profile', 'email'],
      state,
    })(req, res, next);
  });

  router.get('/google/callback', passport.authenticate('google', { failureRedirect: '/login', session: false }), asyncHandler(async (req, res) => {
    await req.user.updateLastLogin();
    const accessToken = generateAccessToken(req.user);
    const refreshTokenDoc = await RefreshToken.createRefreshToken(req.user, {
      userAgent: req.headers['user-agent'],
      ipAddress: req.ip
    });
    const refreshToken = refreshTokenDoc.token;
    res.json({
      success: true,
      data: {
        user: req.user,
        accessToken,
        refreshToken,
        expiresIn: process.env.ACCESS_TOKEN_EXPIRES_IN || '15m',
        refreshTokenExpiresIn: process.env.REFRESH_TOKEN_EXPIRES_IN || '7d'
      }
    });
  }));

  router.get('/github', optionalAuthenticate, (req, res, next) => {
    passport.authenticate('github', { scope: ['user:email'] })(req, res, next);
  });

  router.get('/github/callback', passport.authenticate('github', { failureRedirect: '/login', session: false }), asyncHandler(async (req, res) => {
    await req.user.updateLastLogin();
    const accessToken = generateAccessToken(req.user);
    const refreshTokenDoc = await RefreshToken.createRefreshToken(req.user, {
      userAgent: req.headers['user-agent'],
      ipAddress: req.ip
    });
    const refreshToken = refreshTokenDoc.token;
    res.json({
      success: true,
      data: {
        user: req.user,
        accessToken,
        refreshToken,
        expiresIn: process.env.ACCESS_TOKEN_EXPIRES_IN || '15m',
        refreshTokenExpiresIn: process.env.REFRESH_TOKEN_EXPIRES_IN || '7d'
      }
    });
  }));

  router.post('/revoke', authenticate, asyncHandler(async (req, res) => {
    const { refreshToken, revokeAll } = req.body;
    
    if (revokeAll) {
      await RefreshToken.revokeAllUserTokens(req.user._id);
      res.json({
        success: true,
        message: 'All tokens revoked successfully'
      });
      return;
    }
    
    if (refreshToken) {
      const revoked = await RefreshToken.revokeToken(refreshToken);
      if (!revoked) {
        throw new AppError('Invalid refresh token', 401, 'INVALID_REFRESH_TOKEN');
      }
      res.json({
        success: true,
        message: 'Token revoked successfully'
      });
      return;
    }
    
    throw new AppError('Either refreshToken or revokeAll is required', 400, 'VALIDATION_ERROR');
  }));

  router.post('/logout', authenticate, asyncHandler(async (req, res) => {
    await RefreshToken.revokeAllUserTokens(req.user._id);
    res.json({
      success: true,
      message: 'Logged out successfully'
    });
  }));

  router.post(
    '/link-stellar',
    authenticate,
    asyncHandler(async (req, res) => {
      const { publicKey } = req.body;

      if (!publicKey || !StrKey.isValidEd25519PublicKey(publicKey)) {
        throw new AppError(
          'Valid Stellar public key is required',
          400,
          'INVALID_PUBLIC_KEY'
        );
      }

      const normalizedPublicKey = publicKey.toUpperCase();

      const existingUser = await User.findOne({
        publicKey: normalizedPublicKey,
      });
      if (
        existingUser &&
        existingUser._id.toString() !== req.user._id.toString()
      ) {
        throw new AppError(
          'This Stellar public key is already linked to another account',
          409,
          'KEY_ALREADY_LINKED'
        );
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