const ApiKey = require('../models/ApiKey');
const ApiUsage = require('../models/ApiUsage');
const { AppError } = require('./error-handler');
const { logger } = require('../utils/logger');

/**
 * @title API Key Authentication & Rate Limiting Middleware
 * @author SoroMint Team
 * @notice Authenticates developer-gateway requests via API key, enforces a
 *         per-key sliding-window rate limit, and records usage for billing
 *         and analytics.
 */

const API_KEY_HEADER = 'x-api-key';
const AUTHORIZATION_HEADER = 'authorization';

/**
 * @notice In-memory sliding-window counters keyed by API key id
 * @dev Exposed for tests to reset. Each entry is { windowStart, count, max,
 *      windowMs }. Using an in-process store is sufficient for a single
 *      instance; for multi-node deployments swap this out for Redis.
 */
const rateLimitBuckets = new Map();

/**
 * @notice Clears the in-memory rate limit buckets
 * @dev Intended for use in tests
 */
const resetRateLimitBuckets = () => {
  rateLimitBuckets.clear();
};

/**
 * @notice Extracts the presented API key from the request
 * @param {Object} req - Express request
 * @returns {string|null}
 */
const extractApiKey = (req) => {
  const headerKey = req.headers[API_KEY_HEADER];
  if (typeof headerKey === 'string' && headerKey.trim()) {
    return headerKey.trim();
  }

  const authHeader = req.headers[AUTHORIZATION_HEADER];
  if (typeof authHeader === 'string' && authHeader.startsWith('ApiKey ')) {
    return authHeader.substring(7).trim();
  }

  return null;
};

/**
 * @notice Applies a sliding-window rate limit for an API key
 * @param {Object} apiKey - ApiKey document
 * @returns {{ allowed: boolean, remaining: number, resetAt: number, limit: number, windowMs: number }}
 */
const consumeRateLimit = (apiKey) => {
  const { windowMs, max } = apiKey.getRateLimit();
  const now = Date.now();
  const bucketKey = apiKey._id.toString();

  let bucket = rateLimitBuckets.get(bucketKey);
  if (!bucket || now - bucket.windowStart >= windowMs) {
    bucket = { windowStart: now, count: 0, max, windowMs };
    rateLimitBuckets.set(bucketKey, bucket);
  } else {
    // Pick up any limit changes from key rotation/tier change
    bucket.max = max;
    bucket.windowMs = windowMs;
  }

  bucket.count += 1;
  const remaining = Math.max(0, bucket.max - bucket.count);
  const resetAt = bucket.windowStart + bucket.windowMs;
  const allowed = bucket.count <= bucket.max;

  return { allowed, remaining, resetAt, limit: bucket.max, windowMs };
};

/**
 * @notice Writes a usage record once the response has finished
 * @param {Object} req - Express request
 * @param {Object} res - Express response
 * @param {Object} apiKey - ApiKey document
 * @param {number} startTime - High-resolution start timestamp (ms)
 */
const recordUsage = (req, res, apiKey, startTime) => {
  res.on('finish', () => {
    const durationMs = Date.now() - startTime;
    const doc = {
      apiKeyId: apiKey._id,
      ownerPublicKey: apiKey.ownerPublicKey,
      method: req.method,
      path: req.originalUrl || req.url,
      statusCode: res.statusCode,
      durationMs,
      ip: req.ip || req.connection?.remoteAddress,
      userAgent: req.get ? req.get('user-agent') : undefined,
      timestamp: new Date(),
    };

    ApiUsage.create(doc).catch((error) => {
      logger.warn('Failed to record API usage', {
        error: error.message,
        apiKeyId: apiKey._id.toString(),
      });
    });
  });
};

/**
 * @notice Express middleware that authenticates an API key, enforces its
 *         rate limit, and attaches it to req.apiKey.
 * @param {Object} [options]
 * @param {string[]} [options.requiredScopes] - Scopes the caller must have
 * @returns {Function} Express middleware
 */
const apiKeyAuth = ({ requiredScopes = [] } = {}) => {
  return async (req, res, next) => {
    try {
      const plaintext = extractApiKey(req);
      if (!plaintext) {
        throw new AppError(
          'API key required. Provide it via the X-API-Key header.',
          401,
          'API_KEY_REQUIRED'
        );
      }

      const apiKey = await ApiKey.findByPlaintext(plaintext);
      if (!apiKey) {
        throw new AppError('Invalid API key.', 401, 'INVALID_API_KEY');
      }

      if (!apiKey.isUsable()) {
        const code =
          apiKey.status === 'revoked' ? 'API_KEY_REVOKED' : 'API_KEY_EXPIRED';
        throw new AppError(
          `API key is ${apiKey.status === 'revoked' ? 'revoked' : 'expired'}.`,
          401,
          code
        );
      }

      if (requiredScopes.length > 0) {
        const missing = requiredScopes.filter(
          (scope) => !apiKey.scopes.includes(scope)
        );
        if (missing.length > 0) {
          throw new AppError(
            `API key is missing required scope(s): ${missing.join(', ')}`,
            403,
            'INSUFFICIENT_SCOPE'
          );
        }
      }

      const { allowed, remaining, resetAt, limit, windowMs } =
        consumeRateLimit(apiKey);

      res.setHeader('X-RateLimit-Limit', String(limit));
      res.setHeader('X-RateLimit-Remaining', String(remaining));
      res.setHeader('X-RateLimit-Reset', String(Math.ceil(resetAt / 1000)));
      res.setHeader('X-RateLimit-Window', String(windowMs));

      if (!allowed) {
        const retryAfterSeconds = Math.max(
          1,
          Math.ceil((resetAt - Date.now()) / 1000)
        );
        res.setHeader('Retry-After', String(retryAfterSeconds));
        throw new AppError(
          'Too many requests. Please try again later.',
          429,
          'RATE_LIMIT_EXCEEDED'
        );
      }

      req.apiKey = apiKey;
      req.apiKeyOwnerPublicKey = apiKey.ownerPublicKey;

      recordUsage(req, res, apiKey, Date.now());

      // Best-effort counter + last-used timestamp; failures should not block
      // the request.
      ApiKey.updateOne(
        { _id: apiKey._id },
        { $set: { lastUsedAt: new Date() }, $inc: { usageCount: 1 } }
      ).catch((error) => {
        logger.warn('Failed to update API key usage counters', {
          error: error.message,
          apiKeyId: apiKey._id.toString(),
        });
      });

      next();
    } catch (error) {
      next(error);
    }
  };
};

module.exports = {
  apiKeyAuth,
  extractApiKey,
  consumeRateLimit,
  resetRateLimitBuckets,
  rateLimitBuckets,
  API_KEY_HEADER,
};
