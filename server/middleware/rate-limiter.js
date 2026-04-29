const rateLimit = require('express-rate-limit');

const DEFAULT_LIMIT_MESSAGE = 'Too many requests. Please try again later.';
const DEFAULT_LIMIT_CODE = 'RATE_LIMIT_EXCEEDED';

/**
 * @notice Parses a numeric environment variable and falls back when unset or invalid
 * @param {string|undefined} value - Raw environment variable value
 * @param {number} fallback - Value used when parsing fails
 * @returns {number} Parsed positive integer or the provided fallback
 */
const parsePositiveInteger = (value, fallback) => {
  const parsedValue = Number.parseInt(value, 10);

  if (Number.isNaN(parsedValue) || parsedValue <= 0) {
    return fallback;
  }

  return parsedValue;
};

/**
 * @notice Builds the shared JSON response for requests rejected by rate limiting
 * @returns {Object} Standardized API error payload
 */
const createRateLimitResponse = () => ({
  error: DEFAULT_LIMIT_MESSAGE,
  code: DEFAULT_LIMIT_CODE,
  status: 429,
});

/**
 * @notice Creates a rate limiter with the shared SoroMint error response format
 * @param {Object} options - express-rate-limit options
 * @param {number} options.windowMs - Time window in milliseconds
 * @param {number} options.max - Maximum allowed requests in the time window
 * @returns {Function} Configured Express middleware
 */
const createRateLimiter = ({ windowMs, max }) =>
  rateLimit({
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    message: createRateLimitResponse(),
  });

/**
 * @notice Creates the limiter for the login endpoint to slow brute-force attempts
 * @returns {Function} Express middleware for POST /api/auth/login
 */
const createLoginRateLimiter = () =>
  createRateLimiter({
    windowMs: parsePositiveInteger(
      process.env.LOGIN_RATE_LIMIT_WINDOW_MS,
      15 * 60 * 1000
    ),
    max: parsePositiveInteger(process.env.LOGIN_RATE_LIMIT_MAX_REQUESTS, 5),
  });

/**
 * @notice Creates the limiter for token deployment requests to reduce API abuse
 * @returns {Function} Express middleware for POST /api/tokens
 */
const createTokenDeploymentRateLimiter = () =>
  createRateLimiter({
    windowMs: parsePositiveInteger(
      process.env.TOKEN_DEPLOY_RATE_LIMIT_WINDOW_MS,
      60 * 60 * 1000
    ),
    max: parsePositiveInteger(
      process.env.TOKEN_DEPLOY_RATE_LIMIT_MAX_REQUESTS,
      10
    ),
  });

/**
 * @notice Creates the limiter for WASM security scan requests.
 * @dev    Scan requests are CPU-intensive; a tighter limit prevents abuse.
 *         Defaults: 20 scans per hour per IP.
 * @returns {Function} Express middleware for POST /api/security/scan
 */
const createScanRateLimiter = () =>
  createRateLimiter({
    windowMs: parsePositiveInteger(
      process.env.SCAN_RATE_LIMIT_WINDOW_MS,
      60 * 60 * 1000
    ),
    max: parsePositiveInteger(process.env.SCAN_RATE_LIMIT_MAX_REQUESTS, 20),
  });

/**
 * @notice Creates the limiter for data export requests (CSV/JSON).
 * @dev    Exporting can be resource-intensive; defaults to 10 exports per hour per IP.
 * @returns {Function} Express middleware for export endpoints
 */
const createExportRateLimiter = () =>
  createRateLimiter({
    windowMs: parsePositiveInteger(
      process.env.EXPORT_RATE_LIMIT_WINDOW_MS,
      60 * 60 * 1000
    ),
    max: parsePositiveInteger(process.env.EXPORT_RATE_LIMIT_MAX_REQUESTS, 10),
  });

const loginRateLimiter = createLoginRateLimiter();
const tokenDeploymentRateLimiter = createTokenDeploymentRateLimiter();
const scanRateLimiter = createScanRateLimiter();
const exportRateLimiter = createExportRateLimiter();

module.exports = {
  DEFAULT_LIMIT_MESSAGE,
  DEFAULT_LIMIT_CODE,
  parsePositiveInteger,
  createRateLimitResponse,
  createRateLimiter,
  createLoginRateLimiter,
  createTokenDeploymentRateLimiter,
  createScanRateLimiter,
  createExportRateLimiter,
  loginRateLimiter,
  tokenDeploymentRateLimiter,
  scanRateLimiter,
  exportRateLimiter,
};
