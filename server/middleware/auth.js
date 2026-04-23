const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { AppError } = require('./error-handler');

/**
 * @title JWT Authentication Middleware
 * @author SoroMint Team
 * @notice Middleware for verifying JWT tokens and authenticating users
 * @dev Uses jsonwebtoken library for token verification
 *      Tokens are expected in the Authorization header as "Bearer <token>"
 */

/**
 * @notice Extracts JWT from Authorization header
 * @param {Object} req - Express request object
 * @returns {string|null} The JWT token or null if not found
 */
const extractTokenFromHeader = (req) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }

  return authHeader.substring(7); // Remove 'Bearer ' prefix
};

/**
 * @notice Main authentication middleware
 * @dev Verifies JWT token, loads user, and attaches to request
 *      Sets req.user with user data and req.token with the decoded token
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next middleware function
 * @throws {AppError} 401 if token is missing, invalid, or expired
 * @throws {AppError} 403 if user account is not active
 */
const authenticate = async (req, res, next) => {
  try {
    // Extract token from Authorization header
    const token = extractTokenFromHeader(req);

    if (!token) {
      throw new AppError('Authentication required. Please provide a valid JWT token.', 401, 'AUTH_REQUIRED');
    }

    // Verify token
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    // Find user by ID from token payload
    const user = await User.findById(decoded.id);

    if (!user) {
      throw new AppError('User not found. Token may be invalid.', 401, 'USER_NOT_FOUND');
    }

    // Check if account is active
    if (!user.isActive()) {
      throw new AppError(`Account is ${user.status}. Please contact support.`, 403, 'ACCOUNT_INACTIVE');
    }

    // Attach user and token to request for downstream middleware/routes
    req.user = user;
    req.token = decoded;

    next();
  } catch (error) {
    // Handle JWT-specific errors
    if (error.name === 'TokenExpiredError') {
      return next(new AppError('Token has expired. Please login again.', 401, 'TOKEN_EXPIRED'));
    }

    if (error.name === 'JsonWebTokenError') {
      return next(new AppError('Invalid token format.', 401, 'INVALID_TOKEN'));
    }

    if (error.name === 'NotBeforeError') {
      return next(new AppError('Token is not yet valid.', 401, 'TOKEN_NOT_YET_VALID'));
    }

    // Pass through AppErrors
    if (error instanceof AppError) {
      return next(error);
    }

    // Unknown error
    return next(new AppError('Authentication failed.', 500, 'AUTH_ERROR'));
  }
};

/**
 * @notice Optional authentication middleware
 * @dev Attempts to authenticate but doesn't fail if no token is provided
 *      Useful for routes that behave differently for authenticated vs anonymous users
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next middleware function
 */
const optionalAuthenticate = async (req, res, next) => {
  try {
    const token = extractTokenFromHeader(req);

    if (!token) {
      // No token provided, continue without authentication
      return next();
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.id);

    if (user && user.isActive()) {
      req.user = user;
      req.token = decoded;
    }
    // If user not found or inactive, continue without attaching user
  } catch (error) {
    // Silently fail - optional auth doesn't require valid token
    // Only log in development for debugging
    if (process.env.NODE_ENV !== 'production') {
      console.log('[Optional Auth] Token verification failed:', error.message);
    }
  }

  next();
};

/**
 * @notice Authorization middleware - checks for specific roles
 * @dev Must be used after authenticate middleware
 * @param  {...string} roles - Allowed roles to access the route
 * @returns {Function} Express middleware function
 * @throws {AppError} 403 if user doesn't have required role
 */
const authorize = (...roles) => {
  return (req, res, next) => {
    if (!req.user) {
      return next(new AppError('Authentication required.', 401, 'AUTH_REQUIRED'));
    }

    if (!roles.includes(req.user.role)) {
      return next(new AppError('Access denied. Insufficient permissions.', 403, 'ACCESS_DENIED'));
    }

    next();
  };
};

/**
 * @notice Generates a JWT token for a user
 * @param {Object} user - User document
 * @returns {string} Signed JWT token
 * @throws {Error} If JWT_SECRET is not configured
 */
const generateToken = (user) => {
  if (!process.env.JWT_SECRET) {
    throw new Error('JWT_SECRET environment variable is not configured');
  }

  const payload = {
    id: user._id,
    publicKey: user.publicKey,
    username: user.username,
    type: 'access'
  };

  // Token expires in 24 hours by default
  const options = {
    expiresIn: process.env.JWT_EXPIRES_IN || '24h',
    issuer: 'SoroMint',
    audience: 'SoroMint-API'
  };

  return jwt.sign(payload, process.env.JWT_SECRET, options);
};

/**
 * @notice Decodes a JWT token without verification
 * @dev Use with caution - does not validate token signature or expiration
 * @param {string} token - The JWT token to decode
 * @returns {Object|null} Decoded payload or null if invalid format
 */
const decodeToken = (token) => {
  try {
    return jwt.decode(token);
  } catch (error) {
    return null;
  }
};

/**
 * @notice Verifies a JWT token and returns decoded payload
 * @param {string} token - The JWT token to verify
 * @returns {Object} Decoded and verified payload
 * @throws {Error} If token is invalid or expired
 */
const verifyToken = (token) => {
  if (!process.env.JWT_SECRET) {
    throw new Error('JWT_SECRET environment variable is not configured');
  }

  return jwt.verify(token, process.env.JWT_SECRET);
};

module.exports = {
  authenticate,
  optionalAuthenticate,
  authorize,
  generateToken,
  decodeToken,
  verifyToken,
  extractTokenFromHeader
};
