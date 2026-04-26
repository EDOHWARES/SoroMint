/**
 * @title Environment Configuration Tests
 * @description Test suite for environment variable validation
 * @notice Focuses on testing valid configurations to maintain integration stability
 */

const { validateEnv, initEnv, getEnv } = require("../../config/env-config");
const {
  DEFAULT_NON_PRODUCTION_CORS_ALLOWED_ORIGINS,
} = require("../../config/cors-origins");

describe("Environment Configuration", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    jest.resetModules();
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  describe("validateEnv", () => {
    it("should validate all required environment variables successfully", () => {
      process.env.MONGO_URI = "mongodb://localhost:27017/soromint";
      process.env.JWT_SECRET = "test-secret-key";
      process.env.SOROBAN_RPC_URL = "https://soroban-testnet.stellar.org";

      const env = validateEnv();

      expect(env.MONGO_URI).toBe("mongodb://localhost:27017/soromint");
      expect(env.JWT_SECRET).toBe("test-secret-key");
      expect(env.SOROBAN_RPC_URL).toBe("https://soroban-testnet.stellar.org");
    });

    it("should use default values for optional variables", () => {
      delete process.env.JWT_EXPIRES_IN; // remove setup.js pollution
      process.env.MONGO_URI = "mongodb://localhost:27017/soromint";
      process.env.JWT_SECRET = "test-secret-key";
      process.env.SOROBAN_RPC_URL = "https://soroban-testnet.stellar.org";

      const env = validateEnv();

      expect(env.PORT).toBe(5000);
      expect(env.NODE_ENV).toBe("test"); // Inherited from setup.js
      expect(env.JWT_EXPIRES_IN).toBe("24h");
      expect(env.NETWORK_PASSPHRASE).toBe("Test SDF Network ; September 2015");
      expect(env.ADMIN_SECRET_KEY).toBe("");
      expect(env.PLATFORM_SECRET_KEY).toBe("");
      expect(env.SPONSORSHIP_ENABLED).toBe(false);
      expect(env.MAX_SPONSORSHIP_FEE_STROOPS).toBe(1000000);
      expect(env.LOGIN_RATE_LIMIT_MAX_REQUESTS).toBe(5);
      expect(env.TOKEN_DEPLOY_RATE_LIMIT_MAX_REQUESTS).toBe(10);
      expect(env.CORS_ALLOWED_ORIGINS).toEqual(DEFAULT_NON_PRODUCTION_CORS_ALLOWED_ORIGINS);
    });

    it("should accept custom rate limiting environment values", () => {
      process.env.MONGO_URI = "mongodb://localhost:27017/soromint";
      process.env.JWT_SECRET = "test-secret-key";
      process.env.SOROBAN_RPC_URL = "https://soroban-testnet.stellar.org";
      process.env.LOGIN_RATE_LIMIT_WINDOW_MS = "60000";
      process.env.LOGIN_RATE_LIMIT_MAX_REQUESTS = "9";
      process.env.TOKEN_DEPLOY_RATE_LIMIT_WINDOW_MS = "120000";
      process.env.TOKEN_DEPLOY_RATE_LIMIT_MAX_REQUESTS = "15";

      const env = validateEnv();

      expect(env.LOGIN_RATE_LIMIT_WINDOW_MS).toBe(60000);
      expect(env.LOGIN_RATE_LIMIT_MAX_REQUESTS).toBe(9);
      expect(env.TOKEN_DEPLOY_RATE_LIMIT_WINDOW_MS).toBe(120000);
      expect(env.TOKEN_DEPLOY_RATE_LIMIT_MAX_REQUESTS).toBe(15);
    });

    it("should accept sponsorship environment values", () => {
      process.env.MONGO_URI = "mongodb://localhost:27017/soromint";
      process.env.JWT_SECRET = "test-secret-key";
      process.env.SOROBAN_RPC_URL = "https://soroban-testnet.stellar.org";
      process.env.PLATFORM_SECRET_KEY =
        "SAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
      process.env.SPONSORSHIP_ENABLED = "true";
      process.env.MAX_SPONSORSHIP_FEE_STROOPS = "2500";

      const env = validateEnv();

      expect(env.PLATFORM_SECRET_KEY).toBe(
        "SAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
      );
      expect(env.SPONSORSHIP_ENABLED).toBe(true);
      expect(env.MAX_SPONSORSHIP_FEE_STROOPS).toBe(2500);
    });

    it("should normalize configured CORS allowlist entries", () => {
      process.env.MONGO_URI = "mongodb://localhost:27017/soromint";
      process.env.JWT_SECRET = "test-secret-key";
      process.env.SOROBAN_RPC_URL = "https://soroban-testnet.stellar.org";
      process.env.CORS_ALLOWED_ORIGINS =
        "https://app.example.com, http://localhost:5173/, https://app.example.com";

      const env = validateEnv();

      expect(env.CORS_ALLOWED_ORIGINS).toEqual([
        "https://app.example.com",
        "http://localhost:5173",
      ]);
    });

    it("should use an empty production CORS allowlist by default", () => {
      process.env.NODE_ENV = "production";
      delete process.env.CORS_ALLOWED_ORIGINS;
      process.env.MONGO_URI = "mongodb://localhost:27017/soromint";
      process.env.JWT_SECRET = "test-secret-key";
      process.env.SOROBAN_RPC_URL = "https://soroban-testnet.stellar.org";

      const env = validateEnv();

      expect(env.CORS_ALLOWED_ORIGINS).toEqual([]);
    });

    it("should reject invalid CORS allowlist entries", () => {
      process.env.MONGO_URI = "mongodb://localhost:27017/soromint";
      process.env.JWT_SECRET = "test-secret-key";
      process.env.SOROBAN_RPC_URL = "https://soroban-testnet.stellar.org";
      process.env.CORS_ALLOWED_ORIGINS = "https://app.example.com/dashboard";

      expect(() => {
        validateEnv();
      }).toThrow(/Validation Error: CORS origin must be a bare origin/);
    });

    it("should throw when required environment variables are missing", () => {
      delete process.env.MONGO_URI;
      delete process.env.JWT_SECRET;
      delete process.env.SOROBAN_RPC_URL;

      expect(() => {
        validateEnv();
      }).toThrow(/Validation Error/);
    });
  });

  describe("initEnv and getEnv", () => {
    it("should initialize environment and cache the result", () => {
      process.env.MONGO_URI = "mongodb://localhost:27017/soromint";
      process.env.JWT_SECRET = "test-secret-key";
      process.env.SOROBAN_RPC_URL = "https://soroban-testnet.stellar.org";

      const env1 = initEnv();
      const env2 = initEnv();

      expect(env1).toBe(env2);
    });

    it("should throw when validation fails during initEnv", () => {
      const mockError = jest.spyOn(console, "error").mockImplementation(() => { });

      delete process.env.MONGO_URI;
      delete process.env.JWT_SECRET;
      delete process.env.SOROBAN_RPC_URL;

      jest.resetModules();
      const { initEnv: freshInitEnv } = require("../../config/env-config");

      expect(() => {
        freshInitEnv();
      }).toThrow(/Validation Error/);
      expect(mockError).toHaveBeenCalled();

      mockError.mockRestore();
    });
  });

  describe("getEnv", () => {
    it("should initialize environment if not already cached", () => {
      process.env.MONGO_URI = "mongodb://localhost:27017/soromint";
      process.env.JWT_SECRET = "test-secret-key";
      process.env.SOROBAN_RPC_URL = "https://soroban-testnet.stellar.org";

      jest.resetModules();
      const { getEnv: freshGetEnv } = require("../../config/env-config");

      const env = freshGetEnv();

      expect(env.MONGO_URI).toBe("mongodb://localhost:27017/soromint");
      expect(env.JWT_SECRET).toBe("test-secret-key");
    });

    it("should return cached environment via getEnv if already initialized", () => {
      process.env.MONGO_URI = "mongodb://localhost:27017/soromint";
      process.env.JWT_SECRET = "test-secret-key";
      process.env.SOROBAN_RPC_URL = "https://soroban-testnet.stellar.org";

      const env1 = initEnv();
      const env2 = getEnv();

      expect(env1).toBe(env2);
    });
  });
});
