/**
 * @title Environment Configuration
 * @description Fail-fast environment variable validation using envalid
 * @notice Validates critical environment variables during server startup
 * @dev Prevents server from starting if required environment variables are missing
 */

require("dotenv").config();
const envalid = require("envalid");
const { logger } = require("../utils/logger");

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
    NETWORK_PASSPHRASE: envalid.str({
      default: "Test SDF Network ; September 2015",
      desc: "Stellar network passphrase",
    }),
    ADMIN_SECRET_KEY: envalid.str({
      default: "",
      desc: "Optional secret key for admin bypass",
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
    SENDGRID_API_KEY: envalid.str({
      default: "",
      desc: "SendGrid API key for email notifications",
    }),
    NOTIFICATION_FROM_EMAIL: envalid.str({
      default: "noreply@soromint.io",
      desc: "Sender email address for notifications",
    }),
    VAPID_PUBLIC_KEY: envalid.str({
      default: "",
      desc: "VAPID public key for Web Push notifications",
    }),
    VAPID_PRIVATE_KEY: envalid.str({
      default: "",
      desc: "VAPID private key for Web Push notifications",
    }),
    VAPID_SUBJECT: envalid.str({
      default: "mailto:admin@soromint.io",
      desc: "VAPID subject (mailto: or https: URL)",
    }),
  }, {
    reporter: ({ errors, env }) => {
      if (Object.keys(errors).length > 0) {
        throw new Error("Validation Error: " + Object.keys(errors).join(", "));
      }
    }
  });

  logger.info("Environment variables validated successfully", {
    nodeEnv: cleanEnv.NODE_ENV,
    port: cleanEnv.PORT,
    mongoUri: cleanEnv.MONGO_URI ? cleanEnv.MONGO_URI.replace(/\/\/.*@/, "//***@") : undefined,
    sorobanRpcUrls: cleanEnv.SOROBAN_RPC_URLS || cleanEnv.SOROBAN_RPC_URL,
  });

  return cleanEnv;
}

let validatedEnv = null;

/**
 * @notice Initialize and cache the validated environment variables
 * @returns {Object} Validated environment variables
 */
function initEnv() {
  if (!validatedEnv) {
    try {
      validatedEnv = validateEnv();
    } catch (error) {
      logger.error("Environment validation failed", {
        error: error.message,
      });
      console.error("\n❌ Environment Validation Error:");
      console.error(error.message);
      console.error(
        "\nPlease check your .env file and ensure all required variables are set.",
      );
      console.error("See docs/env-variables.md for more information.\n");
      throw error;
    }
  }

  return validatedEnv;
}

/**
 * @notice Returns the cached environment or initializes it on first access
 * @returns {Object} Validated environment variables
 */
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
