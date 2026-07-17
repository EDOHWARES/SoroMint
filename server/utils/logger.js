const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const winston = require('winston');
const DailyRotateFile = require('winston-daily-rotate-file');
const LokiTransport = require('winston-loki');

const LOG_DIR = path.resolve(
  process.env.LOG_DIR || path.join(process.cwd(), 'logs')
);
const SERVICE = process.env.LOG_SERVICE_NAME || 'soromint-server';
const getEnvironment = () => process.env.NODE_ENV || 'development';
const parseRate = (value, fallback) =>
  Number.isFinite(Number(value))
    ? Math.min(Math.max(Number(value), 0), 1)
    : fallback;

const serializeError = (error) => {
  if (!error) return null;
  if (typeof error === 'string') return { message: error };
  const result = {
    name: error.name || 'Error',
    message: error.message || String(error),
  };
  if (error.stack) result.stack = error.stack;
  for (const [key, value] of Object.entries(error))
    if (!(key in result)) result[key] = value;
  return result;
};

const buildStructuredLogEntry = (level, message, metadata = {}) => {
  const directError = message instanceof Error ? message : null;
  const meta = metadata instanceof Error ? {} : { ...metadata };
  const error = serializeError(directError || meta.error || meta.err);
  delete meta.error;
  delete meta.err;
  const requestId =
    meta.requestId || meta.correlationId || meta.traceId || null;
  const identifiers = {};
  for (const key of ['requestId', 'correlationId', 'traceId'])
    if (meta[key]) identifiers[key] = meta[key];
  for (const key of Object.keys(identifiers)) delete meta[key];
  if (Object.keys(identifiers).length) meta.identifiers = identifiers;
  return {
    level,
    message: directError ? directError.message : String(message),
    timestamp: new Date().toISOString(),
    service: SERVICE,
    environment: getEnvironment(),
    requestId,
    error,
    metadata: meta,
  };
};

const createExactLevelFilter = (level) =>
  winston.format((info) => (info.level === level ? info : false))();
const createLoggerTransports = () => {
  fs.mkdirSync(LOG_DIR, { recursive: true });
  const transports = [
    new winston.transports.Console({ format: winston.format.json() }),
    new DailyRotateFile({
      filename: path.join(LOG_DIR, 'server-%DATE%.log'),
      datePattern: 'YYYY-MM-DD',
      maxSize: '20m',
      maxFiles: '30d',
      format: winston.format.json(),
    }),
    ...['error', 'warn', 'info'].map(
      (level) =>
        new DailyRotateFile({
          filename: path.join(LOG_DIR, `${level}-%DATE%.log`),
          level,
          datePattern: 'YYYY-MM-DD',
          maxSize: '20m',
          maxFiles: '30d',
          format: winston.format.combine(
            createExactLevelFilter(level),
            winston.format.json()
          ),
        })
    ),
  ];
  if (process.env.LOKI_HOST) {
    transports.push(
      new LokiTransport({
        host: process.env.LOKI_HOST,
        basicAuth: process.env.LOKI_BASIC_AUTH || undefined,
        labels: { app: SERVICE, environment: getEnvironment() },
        json: true,
        batching: true,
        interval: 5,
        replaceTimestamp: true,
        onConnectionError: (error) =>
          process.stderr.write(`Loki transport error: ${error.message}\n`),
      })
    );
  }
  return transports;
};

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  transports: createLoggerTransports(),
  exitOnError: false,
});
const rawLog = logger.log.bind(logger);
logger.log = (level, message, metadata) =>
  rawLog(buildStructuredLogEntry(level, message, metadata));
for (const level of ['error', 'warn', 'info', 'http', 'debug'])
  logger[level] = (message, metadata) =>
    rawLog(buildStructuredLogEntry(level, message, metadata));

const generateCorrelationId = () => crypto.randomUUID();
const correlationIdMiddleware = (req, res, next) => {
  const id = req.headers?.['x-correlation-id'] || generateCorrelationId();
  req.correlationId = id;
  req.requestId = id;
  res.setHeader('X-Correlation-ID', id);
  next();
};
const getHttpRequestLoggingConfig = () => ({
  successSampleRate: parseRate(
    process.env.HTTP_LOG_SUCCESS_SAMPLE_RATE,
    getEnvironment() === 'production' ? 0.1 : 1
  ),
  includeClientMetadataForSuccess:
    process.env.HTTP_LOG_SUCCESS_INCLUDE_CLIENT_METADATA !== 'false',
});
const httpLoggerMiddleware = (req, res, next) => {
  const started = Date.now();
  res.on('finish', () => {
    const config = getHttpRequestLoggingConfig();
    const data = {
      requestId: req.requestId,
      correlationId: req.correlationId,
      method: req.method,
      url: req.originalUrl,
      statusCode: res.statusCode,
      durationMs: Date.now() - started,
    };
    if (res.statusCode >= 400 || config.includeClientMetadataForSuccess) {
      data.ip = req.ip || req.connection?.remoteAddress;
      data.userAgent = req.get?.('user-agent');
    }
    if (res.statusCode >= 500) logger.error('HTTP Request', data);
    else if (res.statusCode >= 400) logger.warn('HTTP Request', data);
    else if (
      config.successSampleRate >= 1 ||
      Math.random() < config.successSampleRate
    )
      logger.http('HTTP Request', data);
  });
  next();
};
const logStartupInfo = (port, network) =>
  logger.info('Server starting', {
    port,
    network,
    nodeEnv: getEnvironment(),
    timestamp: new Date().toISOString(),
  });
const logShutdownInfo = (reason) =>
  logger.warn('Server shutting down', {
    reason,
    timestamp: new Date().toISOString(),
  });
const logDatabaseConnection = (success, error) =>
  success
    ? logger.info('MongoDB Connected', { timestamp: new Date().toISOString() })
    : logger.error('MongoDB Connection Error', {
        error: error?.message || 'Unknown error',
        timestamp: new Date().toISOString(),
      });
const logRouteRegistration = (method, routePath) =>
  logger.debug('Route registered', { method, path: routePath });

Object.assign(logger, {
  logger,
  generateCorrelationId,
  correlationIdMiddleware,
  httpLoggerMiddleware,
  getHttpRequestLoggingConfig,
  serializeError,
  buildStructuredLogEntry,
  createExactLevelFilter,
  createLoggerTransports,
  logStartupInfo,
  logShutdownInfo,
  logDatabaseConnection,
  logRouteRegistration,
});
module.exports = logger;
