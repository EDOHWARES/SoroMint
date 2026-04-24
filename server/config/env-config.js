/**
 * @title Environment Configuration
 * @description Fail-fast environment variable validation using envalid
 * @notice Validates critical environment variables during server startup
 * @dev Prevents server from starting if required environment variables are missing
 */

require('dotenv').config();
const envalid = require('envalid');
const { logger } = require('../utils/logger');
const {
  getDefaultCorsAllowedOrigins,
  parseAllowedOrigins,
} = require('./cors-origins');

/**
 * @notice Validates all required environment variables
 * @returns {Object} Validated environment variables
 */
function validateEnv() {
  const cleanEnv = envalid.cleanEnv(process.env, {
    PORT: envalid.port({
      default: 5000,
      desc: "Port number for the Express server",
    }),
    NODE_ENV: envalid.str({
      default: "development",
      choices: ["development", "production", "test"],
      desc: "Application environment mode",
    }),
    MONGO_URI: envalid.url({
      desc: "MongoDB connection URI",
      example: "mongodb://localhost:27017/soromint",
    }),
    JWT_SECRET: envalid.str({
      desc: "Secret key for JWT token signing",
      example: "your-super-secret-jwt-key",
    }),
    JWT_EXPIRES_IN: envalid.str({
      default: "24h",
      desc: "JWT token expiration time",
    }),
    SOROBAN_RPC_URLS: envalid.str({
      desc: "Comma-separated list of Soroban RPC endpoint URLs",
      example: "https://soroban-testnet.stellar.org,https://another-rpc.stellar.org",
      default: "",
    }),
    SOROBAN_RPC_URL: envalid.url({
      desc: "Primary Soroban RPC endpoint URL (deprecated in favor of SOROBAN_RPC_URLS)",
      example: "https://soroban-testnet.stellar.org",
      default: "https://soroban-testnet.stellar.org",
    }),
    HORIZON_URL: envalid.url({
      desc: "Horizon API endpoint URL for fee stats and network data",
      example: "https://horizon-testnet.stellar.org",
      default: "https://horizon-testnet.stellar.org",
    }),
    NETWORK_PASSPHRASE: envalid.str({
      default: "Test SDF Network ; September 2015",
      desc: "Stellar network passphrase",
    }),
    ADMIN_SECRET_KEY: envalid.str({
      default: "",
      desc: "Optional secret key for admin bypass",
    }),
    SENTRY_DSN: envalid.str({
      default: "",
      desc: "Sentry DSN for error tracking (leave empty to disable)",
      example: "https://<key>@o0.ingest.sentry.io/<project>",
    }),
    LOGIN_RATE_LIMIT_WINDOW_MS: envalid.num({
      default: 15 * 60 * 1000,
      desc: "Login rate limit window in milliseconds",
    }),
    LOGIN_RATE_LIMIT_MAX_REQUESTS: envalid.num({
      default: 5,
      desc: "Maximum login attempts per rate limit window",
    }),
    TOKEN_DEPLOY_RATE_LIMIT_WINDOW_MS: envalid.num({
      default: 60 * 60 * 1000,
      desc: "Token deployment rate limit window in milliseconds",
    }),
    TOKEN_DEPLOY_RATE_LIMIT_MAX_REQUESTS: envalid.num({
      default: 10,
      desc: "Maximum token deployments per rate limit window",
    }),
    CORS_ALLOWED_ORIGINS: envalid.str({
      default: getDefaultCorsAllowedOrigins(),
      desc: "Comma-separated list of allowed frontend origins for cross-origin requests",
      example: "https://app.example.com,https://admin.example.com",
    }),
    METRICS_INTERVAL_MS: envalid.num({
      default: 30000,
      desc: "Resource metrics sampling interval in milliseconds",
    }),
    ALERT_THRESHOLD_CPU: envalid.num({
      default: 85,
      desc: "CPU usage % that triggers an alert (0-100)",
    }),
    ALERT_THRESHOLD_MEMORY: envalid.num({
      default: 85,
      desc: "Memory usage % that triggers an alert (0-100)",
    }),
    ALERT_THRESHOLD_DISK: envalid.num({
      default: 90,
      desc: "Disk usage % that triggers an alert (0-100)",
    }),
    REDIS_URL: envalid.str({
      default: "redis://localhost:6379",
      desc: "Redis connection URL for caching",
      example: "redis://localhost:6379",
    }),
    REDIS_PASSWORD: envalid.str({
      default: "",
      desc: "Redis password (optional)",
    }),
    REDIS_DB: envalid.num({
      default: 0,
      desc: "Redis database number",
    }),
    CACHE_TTL_METADATA: envalid.num({
      default: 3600,
      desc: "Cache TTL (Time-To-Live) in seconds for token metadata (default: 1 hour)",
    }),
    PINATA_API_KEY: envalid.str({
      default: "",
      desc: "Pinata API key for IPFS pinning",
    }),
    PINATA_SECRET_API_KEY: envalid.str({
      default: "",
      desc: "Pinata secret API key for IPFS pinning",
    }),
    GOOGLE_CLIENT_ID: envalid.str({
      default: "",
      desc: "Google OAuth2 Client ID",
    }),
    GOOGLE_CLIENT_SECRET: envalid.str({
      default: "",
      desc: "Google OAuth2 Client Secret",
    }),
    GITHUB_CLIENT_ID: envalid.str({
      default: "",
      desc: "GitHub OAuth2 Client ID",
    }),
    GITHUB_CLIENT_SECRET: envalid.str({
      default: "",
      desc: "GitHub OAuth2 Client Secret",
    }),
    SESSION_SECRET: envalid.str({
      default: "keyboard-cat-soromint-default",
      desc: "Secret for express-session",
    }),
    AUTH_CALLBACK_URL: envalid.str({
      default: "http://localhost:5000",
      desc: "Base URL for OAuth callbacks",
    }),
  }, {
    reporter: ({ errors, env }) => {
      if (Object.keys(errors).length > 0) {
        throw new Error("Validation Error: " + Object.keys(errors).join(", "));
      }
    },
  });

  let corsAllowedOrigins;
  try {
    corsAllowedOrigins = parseAllowedOrigins(cleanEnv.CORS_ALLOWED_ORIGINS);
  } catch (error) {
    throw new Error(`Validation Error: ${error.message}`);
  }

  const validatedConfig = Object.freeze({
    ...cleanEnv,
    CORS_ALLOWED_ORIGINS: corsAllowedOrigins,
  });

  logger.info('Environment variables validated successfully', {
    nodeEnv: validatedConfig.NODE_ENV,
    port: validatedConfig.PORT,
    mongoUri: validatedConfig.MONGO_URI
      ? validatedConfig.MONGO_URI.replace(/\/\/.*@/, '//***@')
      : undefined,
    sorobanRpcUrls:
      validatedConfig.SOROBAN_RPC_URLS || validatedConfig.SOROBAN_RPC_URL,
    corsAllowedOrigins: validatedConfig.CORS_ALLOWED_ORIGINS,
  });

  return validatedConfig;
}

let validatedEnv = null;

function initEnv() {
  if (!validatedEnv) {
    try {
      validatedEnv = validateEnv();
    } catch (error) {
      logger.error('Environment validation failed', {
        error: error.message,
      });
      console.error('\n❌ Environment Validation Error:');
      console.error(error.message);
      console.error(
        '\nPlease check your .env file and ensure all required variables are set.'
      );
      throw error;
    }
  }

  return validatedEnv;
}

function getEnv() {
  if (!validatedEnv) {
    return initEnv();
  }

  return validatedEnv;
}

module.exports = {
  validateEnv,
  initEnv,
  getEnv,
};
