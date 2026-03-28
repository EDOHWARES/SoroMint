/**
 * @title Centralized Error Handling Middleware
 * @author SoroMint Team
 * @notice This middleware catches all errors passed to next(error) in Express
 *         and returns standardized JSON error responses to clients.
 * @dev In development mode, full error stacks are logged via Winston.
 *      In production, sensitive error details are omitted from client responses.
 *      Custom errors can be created using the AppError class for specific error codes.
 */

const { logger } = require('../utils/logger');
const { captureException, addBreadcrumb } = require('../config/sentry');

/**
 * @notice Custom error class for application-specific errors
 * @dev Extends native Error class with HTTP status code support
 * @param {string} message - Human-readable error message
 * @param {number} statusCode - HTTP status code (default: 500)
 * @param {string} code - Application-specific error code (default: 'INTERNAL_ERROR')
 */
class AppError extends Error {
  constructor(message, statusCode = 500, code = 'INTERNAL_ERROR') {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.isOperational = true;
    Error.captureStackTrace(this, this.constructor);
  }
}

/**
 * @notice Standardized error response structure
 * @dev Used to format all error responses consistently
 * @param {Error} err - The error object to format
 * @param {boolean} isProduction - Whether running in production mode
 * @returns {Object} Standardized error response object
 */
const formatErrorResponse = (err, isProduction) => {
  const errorMessage = err.message || 'An unexpected error occurred';
  // Handle null/undefined messages
  const safeMessage = errorMessage === 'null' || errorMessage === '' ? 'An unexpected error occurred' : errorMessage;
  
  const response = {
    error: safeMessage,
    code: err.code || 'INTERNAL_ERROR'
  };

  // Include status code if available
  if (err.statusCode) {
    response.status = err.statusCode;
  }

  // In development, include stack trace for debugging
  if (!isProduction && err.stack) {
    response.stack = err.stack;
  }

  return response;
};

/**
 * @notice Logs error details via Winston logger
 * @dev Full error details are logged with appropriate log level
 * @param {Error} err - The error to log
 * @param {Object} req - Express request object for context
 * @param {boolean} isProduction - Whether running in production mode
 */
const logError = (err, req, isProduction) => {
  const logData = {
    message: err.message,
    code: err.code || 'INTERNAL_ERROR',
    statusCode: err.statusCode || 500,
    path: req.originalUrl,
    method: req.method,
    correlationId: req.correlationId,
    isOperational: err.isOperational || false
  };

  // Include stack trace in log data
  if (err.stack) {
    logData.stack = err.stack;
  }

  // Log with appropriate level based on error severity
  if (err.statusCode >= 500) {
    logger.error('Internal Server Error', logData);
  } else if (err.statusCode >= 400) {
    logger.warn('Client Error', logData);
  } else {
    logger.info('Error', logData);
  }
};

/**
 * @notice Handles specific known error types with custom responses
 * @dev Catches common errors like ValidationError, CastError, etc.
 * @param {Error} err - The error to handle
 * @returns {Error} Processed error with appropriate status code and message
 */
const handleKnownErrors = (err) => {
  // Mongoose ValidationError
  if (err.name === 'ValidationError') {
    const messages = Object.values(err.errors).map(e => e.message).join(', ');
    return new AppError(messages, 400, 'VALIDATION_ERROR');
  }

  // Mongoose CastError (invalid ObjectId)
  if (err.name === 'CastError') {
    return new AppError(`Invalid ${err.path}: ${err.value}`, 400, 'INVALID_ID');
  }

  // Mongoose DuplicateKeyError
  if (err.code === 11000) {
    const field = Object.keys(err.keyPattern)[0];
    return new AppError(`${field} already exists`, 409, 'DUPLICATE_KEY');
  }

  // Mongoose NotFoundError (custom pattern)
  if (err.name === 'NotFoundError') {
    return new AppError(err.message, 404, 'NOT_FOUND');
  }

  // JWT errors (if used in future)
  if (err.name === 'JsonWebTokenError') {
    return new AppError('Invalid token', 401, 'INVALID_TOKEN');
  }

  if (err.name === 'TokenExpiredError') {
    return new AppError('Token expired', 401, 'TOKEN_EXPIRED');
  }

  // SyntaxError (JSON parse errors, etc.)
  if (err instanceof SyntaxError) {
    return new AppError('Invalid request payload', 400, 'SYNTAX_ERROR');
  }

  return err;
};

/**
 * @notice 404 Not Found handler for undefined routes
 * @dev Catches requests to routes that don't exist
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next middleware function
 */
const notFoundHandler = (req, res, next) => {
  const err = new AppError(
    `Route ${req.originalUrl} not found`,
    404,
    'ROUTE_NOT_FOUND'
  );
  next(err);
};

/**
 * @notice Main error handling middleware function
 * @dev Express error-handling middleware (must have 4 parameters)
 *      Catches all errors from route handlers and other middleware
 * @param {Error} err - The error object
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next middleware function
 */
const errorHandler = (err, req, res, next) => {
  const isProduction = process.env.NODE_ENV === 'production';

  // Handle known error types
  let processedError = handleKnownErrors(err);

  // If error is not operational (programming bug), don't leak details
  if (!processedError.isOperational && !processedError.statusCode) {
    processedError = new AppError(
      'An unexpected error occurred',
      500,
      'INTERNAL_ERROR'
    );
  }

  // Log the error
  logError(processedError, req, isProduction);

  const statusCode = processedError.statusCode || 500;

  // Capture unexpected server errors in Sentry
  if (statusCode >= 500) {
    addBreadcrumb(`${req.method} ${req.originalUrl}`, { correlationId: req.correlationId });
    captureException(processedError, { req, user: req.user ? { id: req.user._id, publicKey: req.user.publicKey } : undefined });
  }

  // Send standardized response
  const responseBody = formatErrorResponse(processedError, isProduction);

  res.status(statusCode).json(responseBody);
};

/**
 * @notice Async handler wrapper to catch async errors
 * @dev Wraps async route handlers to automatically pass errors to next()
 * @param {Function} fn - Async route handler function
 * @returns {Function} Express middleware function
 * @example
 * router.get('/tokens', asyncHandler(async (req, res) => {
 *   const tokens = await Token.find();
 *   res.json(tokens);
 * }));
 */
const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

module.exports = {
  errorHandler,
  notFoundHandler,
  asyncHandler,
  AppError
};
