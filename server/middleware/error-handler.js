/**
 * @title Centralized Error Handling Middleware
 * @author SoroMint Team
 * @notice This middleware catches all errors passed to next(error) in Express
 *         and returns standardized JSON error responses to clients.
 * @dev In development mode, full error stacks are logged via Winston.
 *      In production, sensitive error details are omitted from client responses.
 *      Custom errors can be created using the AppError class for specific error codes.
 *      Error messages are translated based on the user's language preference
 *      detected from Accept-Language header or other i18next detection methods.
 */

const { logger } = require('../utils/logger');
const { captureException, addBreadcrumb } = require('../config/sentry');
const { getI18n } = require('../config/i18n');

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
 * @dev Used to format all error responses consistently with i18n support
 * @param {Error} err - The error object to format
 * @param {Object} req - Express request object (for i18n context)
 * @param {boolean} isProduction - Whether running in production mode
 * @returns {Object} Standardized error response object
 */
const formatErrorResponse = (err, req, isProduction) => {
  // Get translation function from request (set by i18n middleware)
  const t = req.t || ((key) => key);

  // Extract error code for translation lookup
  const errorCode = err.code || 'INTERNAL_ERROR';

  // Try to translate the error message using the error code
  let translatedMessage;
  try {
    // Build translation key: errors.{category}.{code} or errors.common.{code}
    // The code format is usually CATEGORY_CODE (e.g., VALIDATION_ERROR, AUTH_REQUIRED)
    // We'll try to find the appropriate translation

    // First, try direct translation of the code
    translatedMessage = t(`errors.${errorCode}`, { defaultValue: err.message });

    // If the translation returns the same as the key, try common fallback
    if (translatedMessage === `errors.${errorCode}`) {
      // Try to map code to a common error key
      const commonKey = mapErrorCodeToCommon(errorCode);
      if (commonKey) {
        translatedMessage = t(`errors.common.${commonKey}`, { defaultValue: err.message });
      }
    }
  } catch (e) {
    // If translation fails, fall back to original message
    translatedMessage = err.message;
  }

  // Handle null/undefined messages
  const safeMessage = translatedMessage === 'null' || translatedMessage === '' || !translatedMessage
    ? t('errors.common.unexpected', { defaultValue: 'An unexpected error occurred' })
    : translatedMessage;

  const response = {
    error: safeMessage,
    code: errorCode
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
 * @notice Map error codes to common error translation keys
 * @dev Helps fallback to common translations when specific ones don't exist
 * @param {string} code - Error code
 * @returns {string|null} Common error key or null
 */
const mapErrorCodeToCommon = (code) => {
  const mapping = {
    // Validation errors
    'VALIDATION_ERROR': 'validationFailed',
    'INVALID_ID': 'invalidId',
    'DUPLICATE_KEY': 'duplicate',
    'SYNTAX_ERROR': 'syntaxError',

    // Auth errors
    'AUTH_REQUIRED': 'required',
    'USER_NOT_FOUND': 'userNotFound',
    'ACCOUNT_INACTIVE': 'accountInactive',
    'TOKEN_EXPIRED': 'tokenExpired',
    'INVALID_TOKEN': 'invalidToken',
    'TOKEN_NOT_YET_VALID': 'tokenNotYetValid',
    'AUTH_ERROR': 'authFailed',

    // Not found
    'NOT_FOUND': 'notFound',
    'ROUTE_NOT_FOUND': 'routeNotFound',

    // Forbidden
    'ACCESS_DENIED': 'forbidden',

    // API Key
    'INVALID_API_KEY': 'apiKey.invalid',
    'API_KEY_REVOKED': 'apiKey.revoked',
    'API_KEY_EXPIRED': 'apiKey.expired',
    'RATE_LIMIT_EXCEEDED': 'rateLimit.exceeded',

    // Token
    'TOKEN_NOT_FOUND': 'tokenNotFound',

    // Proposal
    'PROPOSAL_NOT_FOUND': 'proposal.notFound',
    'PROPOSAL_NOT_ACTIVE': 'proposal.notActive',
    'PROPOSAL_EXPIRED': 'proposal.expired',
    'ALREADY_VOTED': 'proposal.alreadyVoted',
    'INVALID_STATUS': 'proposal.invalidStatus',

    // Multisig
    'TRANSACTION_NOT_FOUND': 'multisig.transactionNotFound',

    // Config
    'ENV_NOT_CONFIGURED': 'config.envNotConfigured',
    'CORS_ORIGIN_DENIED': 'cors.originDenied',

    // Internal
    'INTERNAL_ERROR': 'internalError',
  };

  return mapping[code] || null;
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
  const t = req.t || ((key) => key);
  const message = t('errors.common.routeNotFound', { defaultValue: `Route ${req.originalUrl} not found` });
  const err = new AppError(message, 404, 'ROUTE_NOT_FOUND');
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

  // Send standardized response with i18n support
  const responseBody = formatErrorResponse(processedError, req, isProduction);

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
