/**
 * @title Winston Structured Logging Utility
 * @author SoroMint Team
 * @notice Provides multi-channel structured logging with correlation ID support
 * @dev Logs to both console and file (logs/server.log) with daily rotation.
 *      Supports log levels: error, warn, info, http, debug.
 *      Automatically includes timestamps, correlation IDs, and request context.
 */

const winston = require('winston');
const DailyRotateFile = require('winston-daily-rotate-file');
const crypto = require('crypto');
const path = require('path');

const DEFAULT_SUCCESS_HTTP_LOG_SAMPLE_RATE =
  process.env.NODE_ENV === 'production' ? 0.1 : 1;
let cachedHttpRequestLoggingConfigKey = null;
let cachedHttpRequestLoggingConfig = null;

const parseSampleRate = (value, fallback) => {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.min(Math.max(parsed, 0), 1);
};

const parseBoolean = (value, fallback) => {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }

  return value !== 'false' && value !== '0';
};

const getHttpRequestLoggingConfig = () => {
  const configKey = [
    process.env.NODE_ENV || '',
    process.env.HTTP_LOG_SUCCESS_SAMPLE_RATE || '',
    process.env.HTTP_LOG_SUCCESS_INCLUDE_CLIENT_METADATA || '',
  ].join('|');

  if (configKey !== cachedHttpRequestLoggingConfigKey) {
    cachedHttpRequestLoggingConfigKey = configKey;
    cachedHttpRequestLoggingConfig = Object.freeze({
      successSampleRate: parseSampleRate(
        process.env.HTTP_LOG_SUCCESS_SAMPLE_RATE,
        DEFAULT_SUCCESS_HTTP_LOG_SAMPLE_RATE
      ),
      includeClientMetadataForSuccess: parseBoolean(
        process.env.HTTP_LOG_SUCCESS_INCLUDE_CLIENT_METADATA,
        true
      ),
    });
  }

  return cachedHttpRequestLoggingConfig;
};

const shouldLogSuccessfulRequest = (sampleRate) =>
  sampleRate >= 1 || (sampleRate > 0 && Math.random() < sampleRate);

/**
 * @notice Custom format for structured logging
 * @dev Creates a consistent log format with timestamp, level, message, and metadata
 * @param {string} correlationId - Optional request correlation ID for tracing
 * @param {string} level - Log level (error, warn, info, http, debug)
 * @param {string} message - Log message
 * @param {Object} metadata - Additional context/metadata
 * @returns {Object} Formatted log entry
 */
const logFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss.SSS' }),
  winston.format.errors({ stack: true }),
  winston.format.splat(),
  winston.format.json()
);

/**
 * @notice Console transport configuration
 * @dev Outputs colored logs to console for development and debugging
 *      Uses a simplified format for better readability
 */
const consoleTransport = new winston.transports.Console({
  format: winston.format.combine(
    winston.format.colorize(),
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.printf(({ timestamp, level, message, correlationId, ...metadata }) => {
      const correlationPrefix = correlationId ? `[${correlationId}] ` : '';
      let logMessage = `${timestamp} ${level}: ${correlationPrefix}${message}`;
      
      // Include additional metadata if present
      const metaKeys = Object.keys(metadata).filter(key => 
        key !== 'timestamp' && key !== 'level' && key !== 'message'
      );
      
      if (metaKeys.length > 0) {
        const metaString = metaKeys.map(key => `${key}=${metadata[key]}`).join(' ');
        logMessage += ` ${metaString}`;
      }
      
      return logMessage;
    })
  )
});

/**
 * @notice File transport with daily rotation
 * @dev Rotates log files daily and keeps logs for 30 days
 *      Stores logs in logs/server.log with date-based rotation
 */
const fileTransport = new DailyRotateFile({
  filename: path.join(process.cwd(), 'logs', 'server.log'),
  datePattern: 'YYYY-MM-DD',
  maxSize: '20m',
  maxFiles: '30d',
  format: logFormat,
  level: 'debug'
});

/**
 * @notice Logger instance configuration
 * @dev Default log level is 'debug' in development, 'info' in production
 *      All logs include timestamp and optional correlation ID
 */
const logger = winston.createLogger({
  level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
  defaultMeta: { 
    service: 'soromint-server',
    environment: process.env.NODE_ENV || 'development'
  },
  transports: [
    consoleTransport,
    fileTransport
  ],
  exitOnError: false
});

/**
 * @notice Generates a unique correlation ID for request tracing
 * @dev Creates a UUID v4 using crypto module for tracking requests across the application
 * @returns {string} Unique correlation ID
 * @example
 * const correlationId = generateCorrelationId();
 * logger.info('Processing request', { correlationId });
 */
const generateCorrelationId = () => {
  return crypto.randomUUID();
};

/**
 * @notice Express middleware to attach correlation ID to requests
 * @dev Adds correlation ID from header or generates new one
 *      Attaches ID to request object for use in route handlers
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next middleware function
 * @example
 * app.use(correlationIdMiddleware);
 * app.get('/api/tokens', (req, res) => {
 *   logger.info('Fetching tokens', { correlationId: req.correlationId });
 * });
 */
const correlationIdMiddleware = (req, res, next) => {
  // Get correlation ID from header or generate new one
  req.correlationId = req.headers['x-correlation-id'] || generateCorrelationId();
  
  // Set response header for client tracing
  res.setHeader('X-Correlation-ID', req.correlationId);
  
  next();
};

/**
 * @notice Express middleware for HTTP request logging
 * @dev Logs all HTTP requests with method, URL, status code, and duration
 *      Automatically includes correlation ID from request context
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next middleware function
 * @example
 * app.use(httpLoggerMiddleware);
 */
const httpLoggerMiddleware = (req, res, next) => {
  const {
    successSampleRate,
    includeClientMetadataForSuccess,
  } = getHttpRequestLoggingConfig();
  const shouldTrackSuccessfulRequests = successSampleRate > 0;
  const startTimeMs = shouldTrackSuccessfulRequests ? Date.now() : null;

  const addFinishListener = typeof res.once === 'function' ? res.once.bind(res) : res.on.bind(res);

  addFinishListener('finish', () => {
    const statusCode = res.statusCode;
    const isSuccessfulResponse = statusCode < 400;

    if (
      isSuccessfulResponse &&
      !shouldLogSuccessfulRequest(successSampleRate)
    ) {
      return;
    }

    const logData = {
      correlationId: req.correlationId,
      method: req.method,
      url: req.originalUrl,
      statusCode,
    };

    if (startTimeMs !== null) {
      logData.durationMs = Date.now() - startTimeMs;
    }

    if (!isSuccessfulResponse || includeClientMetadataForSuccess) {
      logData.ip = req.ip || req.connection?.remoteAddress;
      logData.userAgent = req.get('user-agent');
    }

    if (isSuccessfulResponse && successSampleRate < 1) {
      logData.sampleRate = successSampleRate;
    }

    if (statusCode >= 500) {
      logger.error('HTTP Request', logData);
    } else if (statusCode >= 400) {
      logger.warn('HTTP Request', logData);
    } else {
      logger.http('HTTP Request', logData);
    }
  });

  next();
};

/**
 * @notice Logs application startup information
 * @dev Called when server starts to log configuration details
 * @param {number} port - Server port number
 * @param {string} network - Stellar network passphrase
 * @example
 * logStartupInfo(5000, 'Futurenet');
 */
const logStartupInfo = (port, network) => {
  logger.info('Server starting', {
    port,
    network,
    nodeEnv: process.env.NODE_ENV || 'development',
    timestamp: new Date().toISOString()
  });
};

/**
 * @notice Logs application shutdown information
 * @dev Called when server is shutting down gracefully
 * @param {string} reason - Reason for shutdown (signal or manual)
 * @example
 * logShutdownInfo('SIGTERM');
 */
const logShutdownInfo = (reason) => {
  logger.warn('Server shutting down', {
    reason,
    timestamp: new Date().toISOString()
  });
};

/**
 * @notice Logs database connection events
 * @dev Handles MongoDB connection success/failure events
 * @param {boolean} success - Whether connection was successful
 * @param {Error|null} error - Error object if connection failed
 * @example
 * logDatabaseConnection(true, null);
 */
const logDatabaseConnection = (success, error = null) => {
  if (success) {
    logger.info('MongoDB Connected', {
      timestamp: new Date().toISOString()
    });
  } else {
    logger.error('MongoDB Connection Error', {
      error: error ? error.message : 'Unknown error',
      timestamp: new Date().toISOString()
    });
  }
};

/**
 * @notice Logs API route registration
 * @dev Useful for debugging route registration during startup
 * @param {string} method - HTTP method (GET, POST, etc.)
 * @param {string} path - Route path
 * @example
 * logRouteRegistration('GET', '/api/tokens');
 */
const logRouteRegistration = (method, path) => {
  logger.debug('Route registered', {
    method,
    path
  });
};

module.exports = {
  logger,
  generateCorrelationId,
  correlationIdMiddleware,
  httpLoggerMiddleware,
  getHttpRequestLoggingConfig,
  shouldLogSuccessfulRequest,
  logStartupInfo,
  logShutdownInfo,
  logDatabaseConnection,
  logRouteRegistration
};
