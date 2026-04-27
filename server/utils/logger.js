const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const winston = require('winston');
const DailyRotateFile = require('winston-daily-rotate-file');

const DEFAULT_SUCCESS_HTTP_LOG_SAMPLE_RATE =
  process.env.NODE_ENV === 'production' ? 0.1 : 1;
const DEFAULT_LOG_LEVEL =
  process.env.LOG_LEVEL || (process.env.NODE_ENV === 'production' ? 'http' : 'debug');
const LOG_DIR = path.resolve(process.env.LOG_DIR || path.join(process.cwd(), 'logs'));
const LOG_MAX_SIZE = process.env.LOG_MAX_SIZE || '20m';
const LOG_MAX_FILES = process.env.LOG_MAX_FILES || '30d';
const LOG_SERVICE_NAME = process.env.LOG_SERVICE_NAME || 'soromint-server';
const EXACT_LEVEL_TRANSPORTS = ['error', 'warn', 'info'];

let cachedHttpRequestLoggingConfigKey = null;
let cachedHttpRequestLoggingConfig = null;

const isPlainObject = (value) =>
  Object.prototype.toString.call(value) === '[object Object]';

const getEnvironment = () => process.env.NODE_ENV || 'development';

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
    getEnvironment(),
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

const resolveRequestId = (value = {}) => {
  if (!value || typeof value !== 'object') {
    return null;
  }

  return value.requestId || value.correlationId || value.traceId || null;
};

const serializeError = (value) => {
  if (!value) {
    return null;
  }

  if (typeof value === 'string') {
    return { message: value };
  }

  if (!(value instanceof Error) && !isPlainObject(value)) {
    return { message: String(value) };
  }

  const errorDetails = {
    name: value.name || 'Error',
    message: value.message || String(value),
  };

  if (value.stack) {
    errorDetails.stack = value.stack;
  }

  for (const [key, keyValue] of Object.entries(value)) {
    if (keyValue === undefined) {
      continue;
    }

    if (key === 'cause' && keyValue) {
      errorDetails.cause = serializeError(keyValue);
      continue;
    }

    if (!(key in errorDetails)) {
      errorDetails[key] = keyValue;
    }
  }

  return errorDetails;
};

const normalizeMetaArguments = (metaArgs = []) => {
  const metadata = {};
  const additionalErrors = [];

  for (const metaArg of metaArgs) {
    if (metaArg === undefined) {
      continue;
    }

    if (metaArg instanceof Error) {
      additionalErrors.push(metaArg);
      continue;
    }

    if (isPlainObject(metaArg)) {
      Object.assign(metadata, metaArg);
      continue;
    }

    if (!Array.isArray(metadata.extra)) {
      metadata.extra = [];
    }

    metadata.extra.push(metaArg);
  }

  return { metadata, additionalErrors };
};

const buildStructuredLogEntry = (level, message, ...metaArgs) => {
  let resolvedMessage = message;
  let remainingMetaArgs = metaArgs;

  if (message instanceof Error) {
    resolvedMessage = message.message;
    remainingMetaArgs = [message, ...metaArgs];
  } else if (isPlainObject(message) && metaArgs.length === 0) {
    resolvedMessage = message.message || level;
    remainingMetaArgs = [message];
  }

  const { metadata: rawMetadata, additionalErrors } = normalizeMetaArguments(remainingMetaArgs);
  const metadata = { ...rawMetadata };
  const identifiers = {};

  if (metadata.requestId !== undefined) {
    identifiers.requestId = metadata.requestId;
  }
  if (metadata.correlationId !== undefined) {
    identifiers.correlationId = metadata.correlationId;
  }
  if (metadata.traceId !== undefined) {
    identifiers.traceId = metadata.traceId;
  }

  const requestId = resolveRequestId(metadata);

  delete metadata.requestId;
  delete metadata.correlationId;
  delete metadata.traceId;

  let error = null;
  if (metadata.error !== undefined) {
    error = serializeError(metadata.error);
    delete metadata.error;
  }

  if (!error && metadata.err !== undefined) {
    error = serializeError(metadata.err);
    delete metadata.err;
  }

  if (!error && additionalErrors.length > 0) {
    error = serializeError(additionalErrors[0]);
  }

  if (!error && metadata.stack) {
    error = serializeError({ message: resolvedMessage, stack: metadata.stack });
    delete metadata.stack;
  }

  if (Object.keys(identifiers).length > 0) {
    metadata.identifiers = identifiers;
  }

  return {
    level,
    message: typeof resolvedMessage === 'string' ? resolvedMessage : String(resolvedMessage),
    timestamp: new Date().toISOString(),
    service: LOG_SERVICE_NAME,
    environment: getEnvironment(),
    requestId,
    error,
    metadata,
  };
};

const createExactLevelFilter = (targetLevel) =>
  winston.format((info) => (info.level === targetLevel ? info : false))();

const createRotateTransport = ({ filename, level, exactLevel = null }) => {
  const formats = [];
  if (exactLevel) {
    formats.push(createExactLevelFilter(exactLevel));
  }
  formats.push(winston.format.json());

  return new DailyRotateFile({
    filename: path.join(LOG_DIR, filename),
    datePattern: 'YYYY-MM-DD',
    maxSize: LOG_MAX_SIZE,
    maxFiles: LOG_MAX_FILES,
    level,
    format: winston.format.combine(...formats),
  });
};

const createLoggerTransports = () => {
  fs.mkdirSync(LOG_DIR, { recursive: true });

  return [
    new winston.transports.Console({
      level: DEFAULT_LOG_LEVEL,
      format: winston.format.json(),
    }),
    createRotateTransport({
      filename: 'server-%DATE%.log',
      level: DEFAULT_LOG_LEVEL,
    }),
    ...EXACT_LEVEL_TRANSPORTS.map((level) =>
      createRotateTransport({
        filename: `${level}-%DATE%.log`,
        level,
        exactLevel: level,
      })
    ),
  ];
};
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
    winston.format.printf(
      ({ timestamp, level, message, correlationId, ...metadata }) => {
        const correlationPrefix = correlationId ? `[${correlationId}] ` : '';
        let logMessage = `${timestamp} ${level}: ${correlationPrefix}${message}`;

        // Include additional metadata if present
        const metaKeys = Object.keys(metadata).filter(
          (key) => key !== 'timestamp' && key !== 'level' && key !== 'message'
        );

        if (metaKeys.length > 0) {
          const metaString = metaKeys
            .map((key) => `${key}=${metadata[key]}`)
            .join(' ');
          logMessage += ` ${metaString}`;
        }

        return logMessage;
      }
    )
  ),
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
  level: 'debug',
});

const logger = winston.createLogger({
  levels: winston.config.npm.levels,
  level: DEFAULT_LOG_LEVEL,
  transports: createLoggerTransports(),
  exitOnError: false,
});

const rawLog = logger.log.bind(logger);
const supportedLevels = ['error', 'warn', 'info', 'http', 'debug'];

logger.log = (levelOrEntry, message, ...metaArgs) => {
  if (isPlainObject(levelOrEntry) && levelOrEntry.level) {
    const { level, message: entryMessage, ...entryMetadata } = levelOrEntry;
    return rawLog(buildStructuredLogEntry(level, entryMessage, entryMetadata));
  }

  return rawLog(buildStructuredLogEntry(levelOrEntry, message, ...metaArgs));
};

for (const level of supportedLevels) {
  logger[level] = (message, ...metaArgs) =>
    rawLog(buildStructuredLogEntry(level, message, ...metaArgs));
}

const generateCorrelationId = () => crypto.randomUUID();

const withRequestContext = (req, metadata = {}) => {
  const requestContext = {};

  if (req?.requestId || req?.correlationId || req?.traceId) {
    requestContext.requestId = req.requestId || req.correlationId || req.traceId;
  }

  if (req?.correlationId) {
    requestContext.correlationId = req.correlationId;
  }

  if (req?.traceId) {
    requestContext.traceId = req.traceId;
  }

  return {
    ...metadata,
    ...requestContext,
  };
};

const createRequestLogger = (req) => ({
  log(level, message, metadata = {}) {
    return logger.log(level, message, withRequestContext(req, metadata));
  },
  error(message, metadata = {}) {
    return logger.error(message, withRequestContext(req, metadata));
  },
  warn(message, metadata = {}) {
    return logger.warn(message, withRequestContext(req, metadata));
  },
  info(message, metadata = {}) {
    return logger.info(message, withRequestContext(req, metadata));
  },
  http(message, metadata = {}) {
    return logger.http(message, withRequestContext(req, metadata));
  },
  debug(message, metadata = {}) {
    return logger.debug(message, withRequestContext(req, metadata));
  },
  level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
  defaultMeta: {
    service: 'soromint-server',
    environment: process.env.NODE_ENV || 'development',
  },
  transports: [consoleTransport, fileTransport],
  exitOnError: false,
});

const correlationIdMiddleware = (req, res, next) => {
  req.correlationId = req.headers['x-correlation-id'] || generateCorrelationId();
  req.requestId = req.correlationId;
  res.setHeader('X-Correlation-ID', req.correlationId);
  // Get correlation ID from header or generate new one
  req.correlationId =
    req.headers['x-correlation-id'] || generateCorrelationId();

  // Set response header for client tracing
  res.setHeader('X-Correlation-ID', req.correlationId);

  next();
};

const httpLoggerMiddleware = (req, res, next) => {
  const {
    successSampleRate,
    includeClientMetadataForSuccess,
  } = getHttpRequestLoggingConfig();
  const startTimeMs = Date.now();
  const addFinishListener = typeof res.once === 'function' ? res.once.bind(res) : res.on.bind(res);

  addFinishListener('finish', () => {
    const statusCode = res.statusCode;
    const isSuccessfulResponse = statusCode < 400;

    if (isSuccessfulResponse && !shouldLogSuccessfulRequest(successSampleRate)) {
      return;
    }

    const logData = withRequestContext(req, {
      method: req.method,
      url: req.originalUrl,
      statusCode,
      durationMs: Date.now() - startTimeMs,
    });

    if (!isSuccessfulResponse || includeClientMetadataForSuccess) {
      logData.ip = req.ip || req.connection?.remoteAddress;
      logData.userAgent = typeof req.get === 'function' ? req.get('user-agent') : undefined;
    }

    if (isSuccessfulResponse && successSampleRate < 1) {
      logData.sampleRate = successSampleRate;
    }

    if (statusCode >= 500) {
  const startTime = Date.now();
  const correlationId = req.correlationId;

  // Log when response is finished
  res.on('finish', () => {
    const duration = Date.now() - startTime;
    const logData = {
      correlationId,
      method: req.method,
      url: req.originalUrl,
      statusCode: res.statusCode,
      durationMs: duration,
      ip: req.ip || req.connection.remoteAddress,
      userAgent: req.get('user-agent'),
    };

    // Log level based on status code
    if (res.statusCode >= 500) {
      logger.error('HTTP Request', logData);
    } else if (statusCode >= 400) {
      logger.warn('HTTP Request', logData);
    } else {
      logger.http('HTTP Request', logData);
    }
  });

  next();
};

const logStartupInfo = (port, network) => {
  logger.info('Server starting', {
    port,
    network,
    nodeEnv: getEnvironment(),
    nodeEnv: process.env.NODE_ENV || 'development',
    timestamp: new Date().toISOString(),
  });
};

const logShutdownInfo = (reason) => {
  logger.warn('Server shutting down', { reason });
  logger.warn('Server shutting down', {
    reason,
    timestamp: new Date().toISOString(),
  });
};

const logDatabaseConnection = (success, error = null) => {
  if (success) {
    logger.info('MongoDB Connected');
    return;
    logger.info('MongoDB Connected', {
      timestamp: new Date().toISOString(),
    });
  } else {
    logger.error('MongoDB Connection Error', {
      error: error ? error.message : 'Unknown error',
      timestamp: new Date().toISOString(),
    });
  }

  logger.error('MongoDB Connection Error', {
    error: error || 'Unknown error',
  });
};

const logRouteRegistration = (method, routePath) => {
  logger.debug('Route registered', {
    method,
    path: routePath,
    path,
  });
};

Object.assign(logger, {
  logger,
  generateCorrelationId,
  correlationIdMiddleware,
  httpLoggerMiddleware,
  getHttpRequestLoggingConfig,
  shouldLogSuccessfulRequest,
  resolveRequestId,
  serializeError,
  buildStructuredLogEntry,
  createExactLevelFilter,
  createLoggerTransports,
  withRequestContext,
  createRequestLogger,
  logStartupInfo,
  logShutdownInfo,
  logDatabaseConnection,
  logRouteRegistration,
});

module.exports = logger;
};
