/**
 * @title Environment Configuration
 * @description Fail-fast environment variable validation using envalid
 * @notice Validates critical environment variables during server startup
 * @dev Prevents server from starting if required variables are missing
 */

const envalid = require("envalid");
const { logger } = require("../utils/logger");

/**
 * @notice Validates all required environment variables
 * @dev Uses envalid to ensure critical variables are present and valid
 * @throws {Error} Exits process if validation fails
 */
function validateEnv() {
  /**
   * @notice Clean environment variables specification
   * @dev Defines validation rules for each environment variable
   */
  const cleanEnv = envalid.cleanEnv(process.env, {
    // Server Configuration
    PORT: envalid.port({
      default: 5000,
      desc: "Port number for the Express server",
    }),
    NODE_ENV: envalid.str({
      default: "development",
      choices: ["development", "production", "test"],
      desc: "Application environment mode",
    }),

    // Database Configuration
    MONGO_URI: envalid.url({
      desc: "MongoDB connection URI",
      example: "mongodb://localhost:27017/soromint",
    }),

    // JWT Authentication
    JWT_SECRET: envalid.str({
      desc: "Secret key for JWT token signing",
      example: "your-super-secret-jwt-key",
    }),
    JWT_EXPIRES_IN: envalid.str({
      default: "24h",
      desc: "JWT token expiration time",
    }),

    // Stellar/Soroban Configuration
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

    // Optional Configuration
    ADMIN_SECRET_KEY: envalid.str({
      default: "",
      desc: "Optional admin secret key for server-side signing",
    }),
  });

  logger.info("Environment variables validated successfully", {
    nodeEnv: cleanEnv.NODE_ENV,
    port: cleanEnv.PORT,
    mongoUri: cleanEnv.MONGO_URI.replace(/\/\/.*@/, "//***@"), // Hide credentials in logs
    sorobanRpcUrls: cleanEnv.SOROBAN_RPC_URLS || cleanEnv.SOROBAN_RPC_URL,
  });

  return cleanEnv;
}

/**
 * @notice Exported validated environment variables
 * @dev Call validateEnv() early in application startup
 */
let validatedEnv = null;

/**
 * @notice Initialize and validate environment
 * @dev Must be called before accessing any environment variables
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
      console.error("\nPlease check your .env file and ensure all required variables are set.");
      console.error("See docs/env-variables.md for more information.\n");
      process.exit(1);
    }
  }
  return validatedEnv;
}

/**
 * @notice Get validated environment variables
 * @dev Returns cached validated environment
 * @returns {Object} Validated environment variables
 */
function getEnv() {
  if (!validatedEnv) {
    return initEnv();
  }
  return validatedEnv;
}

module.exports = {
  initEnv,
  getEnv,
  validateEnv,
};
