const express = require('express');
const { StrKey } = require('@stellar/stellar-sdk');
const User = require('../models/User');
const { generateToken, authenticate } = require('../middleware/auth');
const { asyncHandler, AppError } = require('../middleware/error-handler');

const router = express.Router();

/**
 * @title Authentication Routes
 * @author SoroMint Team
 * @notice Handles user registration and login via Stellar public key authentication
 * @dev Implements a challenge/response mechanism for MVP using public key verification
 */

/**
 * @route POST /api/auth/register
 * @description Register a new user with their Stellar public key
 * @access Public
 *
 * @body {string} publicKey - Stellar public key (G-address)
 * @body {string} [username] - Optional username/nickname
 *
 * @returns {Object} 201 - User object and JWT token
 * @returns {Object} 400 - Validation error
 * @returns {Object} 409 - User already exists
 */
router.post('/register', asyncHandler(async (req, res) => {
  const { publicKey, username } = req.body;

  // Validate public key is provided
  if (!publicKey) {
    throw new AppError('Public key is required for registration', 400, 'VALIDATION_ERROR');
  }

  // Validate Stellar public key format using Stellar SDK
  if (!StrKey.isValidEd25519PublicKey(publicKey)) {
    throw new AppError(
      'Invalid Stellar public key format. Must be a valid G-address (Ed25519 public key)',
      400,
      'INVALID_PUBLIC_KEY'
    );
  }

  // Normalize to uppercase for consistency
  const normalizedPublicKey = publicKey.toUpperCase();

  // Check if user already exists
  const existingUser = await User.findByPublicKey(normalizedPublicKey);
  if (existingUser) {
    throw new AppError('User with this public key already registered', 409, 'USER_EXISTS');
  }

  // Validate username if provided
  if (username && (username.length < 3 || username.length > 50)) {
    throw new AppError('Username must be between 3 and 50 characters', 400, 'VALIDATION_ERROR');
  }

  // Create new user
  const user = new User({
    publicKey: normalizedPublicKey,
    username: username ? username.trim() : undefined
  });

  await user.save();

  // Generate JWT token
  const token = generateToken(normalizedPublicKey, user.username);

  // Return user data and token
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
      token,
      expiresIn: process.env.JWT_EXPIRES_IN || '24h'
    }
  });
}));

/**
 * @route POST /api/auth/login
 * @description Login with Stellar public key
 * @notice For MVP, this is a simple public key check. In production, implement challenge/response.
 * @access Public
 *
 * @body {string} publicKey - Stellar public key (G-address)
 * @body {string} [signature] - Optional signature for challenge/response (future enhancement)
 * @body {string} [challenge] - Optional challenge string (future enhancement)
 *
 * @returns {Object} 200 - User object and JWT token
 * @returns {Object} 400 - Validation error
 * @returns {Object} 401 - User not found or invalid credentials
 * @returns {Object} 403 - Account suspended/deleted
 */
router.post('/login', asyncHandler(async (req, res) => {
  const { publicKey, signature, challenge } = req.body;

  // Validate public key is provided
  if (!publicKey) {
    throw new AppError('Public key is required for login', 400, 'VALIDATION_ERROR');
  }

  // Validate Stellar public key format
  if (!StrKey.isValidEd25519PublicKey(publicKey)) {
    throw new AppError(
      'Invalid Stellar public key format. Must be a valid G-address (Ed25519 public key)',
      400,
      'INVALID_PUBLIC_KEY'
    );
  }

  const normalizedPublicKey = publicKey.toUpperCase();

  // Find user
  const user = await User.findByPublicKey(normalizedPublicKey);

  if (!user) {
    throw new AppError('User not found. Please register first.', 401, 'USER_NOT_FOUND');
  }

  // Check account status
  if (!user.isActive()) {
    throw new AppError(`Account is ${user.status}. Please contact support.`, 403, 'ACCOUNT_INACTIVE');
  }

  // MVP: Simple public key check
  // TODO: Implement challenge/response for enhanced security
  // This would involve:
  // 1. Server generates a random challenge string
  // 2. Client signs the challenge with their secret key
  // 3. Server verifies the signature using the stored public key
  if (signature && challenge) {
    // Future enhancement: Validate signature
    // const isValidSignature = await verifySignature(publicKey, signature, challenge);
    // if (!isValidSignature) {
    //   throw new AppError('Invalid signature. Authentication failed.', 401, 'INVALID_SIGNATURE');
    // }
    console.log('[Login] Signature/challenge provided but not yet validated (MVP mode)');
  }

  // Update last login timestamp
  await user.updateLastLogin();

  // Generate JWT token
  const token = generateToken(normalizedPublicKey, user.username);

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
      token,
      expiresIn: process.env.JWT_EXPIRES_IN || '24h'
    }
  });
}));

/**
 * @route GET /api/auth/me
 * @description Get current authenticated user profile
 * @access Private (requires valid JWT)
 *
 * @header {string} Authorization - Bearer <JWT token>
 *
 * @returns {Object} 200 - User profile data
 * @returns {Object} 401 - Invalid or missing token
 */
router.get('/me', authenticate, asyncHandler(async (req, res) => {
  res.json({
    success: true,
    data: {
      user: {
        id: req.user._id,
        publicKey: req.user.publicKey,
        username: req.user.username,
        status: req.user.status,
        createdAt: req.user.createdAt,
        lastLoginAt: req.user.lastLoginAt
      }
    }
  });
}));

/**
 * @route POST /api/auth/refresh
 * @description Refresh JWT token for authenticated user
 * @access Private (requires valid JWT)
 *
 * @header {string} Authorization - Bearer <JWT token>
 *
 * @returns {Object} 200 - New JWT token
 * @returns {Object} 401 - Invalid or expired token
 */
router.post('/refresh', authenticate, asyncHandler(async (req, res) => {
  // Generate new token with same user data
  const newToken = generateToken(req.user.publicKey, req.user.username);

  res.json({
    success: true,
    message: 'Token refreshed successfully',
    data: {
      token: newToken,
      expiresIn: process.env.JWT_EXPIRES_IN || '24h'
    }
  });
}));

/**
 * @route PUT /api/auth/profile
 * @description Update user profile information
 * @access Private (requires valid JWT)
 *
 * @header {string} Authorization - Bearer <JWT token>
 * @body {string} [username] - New username (3-50 characters)
 *
 * @returns {Object} 200 - Updated user profile
 * @returns {Object} 400 - Validation error
 */
router.put('/profile', authenticate, asyncHandler(async (req, res) => {
  const { username } = req.body;

  // Validate username if provided
  if (username !== undefined) {
    if (username.length < 3 || username.length > 50) {
      throw new AppError('Username must be between 3 and 50 characters', 400, 'VALIDATION_ERROR');
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
        lastLoginAt: req.user.lastLoginAt
      }
    }
  });
}));

module.exports = router;
