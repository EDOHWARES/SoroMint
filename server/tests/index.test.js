describe("Server Index", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = {
      ...originalEnv,
      NODE_ENV: "test",
    };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it("should connect to the database using the validated environment", async () => {
    const connect = jest.fn().mockResolvedValue(undefined);
    const logDatabaseConnection = jest.fn();
    const initEnv = jest.fn();
    const getEnv = jest.fn().mockReturnValue({
      MONGO_URI: "mongodb://localhost:27017/soromint",
      PORT: 5000,
      NETWORK_PASSPHRASE: "Test SDF Network ; September 2015",
    });

    jest.doMock("mongoose", () => ({ connect }));
    jest.doMock("../services/backup-service", () => ({ scheduleBackups: jest.fn() }));
    jest.doMock("mongoose", () => ({ connect, Schema: class Schema { index() {} }, model: jest.fn(() => ({})) }));
    jest.doMock("../config/env-config", () => ({ initEnv, getEnv }));
    jest.doMock("../utils/logger", () => ({
      logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn() },
      correlationIdMiddleware: jest.fn((req, res, next) => next()),
      httpLoggerMiddleware: jest.fn((req, res, next) => next()),
      logStartupInfo: jest.fn(),
      logDatabaseConnection,
    }));
    jest.doMock("../config/swagger", () => ({ setupSwagger: jest.fn() }));
    jest.doMock("../routes/auth-routes", () => (req, res, next) => next());
    jest.doMock("../routes/status-routes", () => (req, res, next) => next());
    jest.doMock("../routes/audit-routes", () => (req, res, next) => next());
    jest.doMock("../routes/token-routes", () => (req, res, next) => next());
    jest.doMock("../routes/analytics-routes", () => (req, res, next) => next());
    jest.doMock("../routes/webhook-routes", () => (req, res, next) => next());
    jest.doMock("../routes/notification-routes", () => (req, res, next) => next());
    jest.doMock("../routes/multisig-routes", () => (req, res, next) => next());
    jest.doMock("../routes/vault-routes", () => (req, res, next) => next());
    jest.doMock("../routes/sponsorship-routes", () => (req, res, next) => next());
    jest.doMock("../routes/analytics-routes", () => (req, res, next) => next());
    jest.doMock("../middleware/security-headers", () => ({ securityHeaders: (req, res, next) => next() }));
    jest.doMock("../services/backup-service", () => ({ scheduleBackups: jest.fn() }));
    jest.doMock("../config/sentry", () => ({ initSentry: jest.fn() }));
    jest.doMock("../middleware/error-handler", () => ({
      errorHandler: jest.fn((err, req, res, next) => next(err)),
      notFoundHandler: jest.fn((req, res, next) => next()),
    }));

    const { connectDatabase } = require("../index");
    await connectDatabase();

    expect(initEnv).toHaveBeenCalled();
    expect(getEnv).toHaveBeenCalled();
    expect(connect).toHaveBeenCalledWith("mongodb://localhost:27017/soromint");
    expect(logDatabaseConnection).toHaveBeenCalledWith(true);
  });

  it("should start the server and log startup information", async () => {
    const listen = jest.fn((port, cb) => cb());
    const use = jest.fn();
    const options = jest.fn();
    const expressApp = { use, options, listen };
    const expressFn = jest.fn(() => expressApp);
    expressFn.json = jest.fn(() => "json-middleware");

    const initEnv = jest.fn();
    const getEnv = jest.fn().mockReturnValue({
      MONGO_URI: "mongodb://localhost:27017/soromint",
      PORT: 5050,
      NETWORK_PASSPHRASE: "Test SDF Network ; September 2015",
      CORS_ALLOWED_ORIGINS: ["https://app.example.com"],
    });
    const connect = jest.fn().mockResolvedValue(undefined);
    const logStartupInfo = jest.fn();
    const logDatabaseConnection = jest.fn();
    const setupSwagger = jest.fn();

    jest.spyOn(console, "log").mockImplementation(() => {});
    jest.doMock("express", () => expressFn);
    jest.doMock("cors", () => jest.fn(() => "cors-middleware"));
    jest.doMock("mongoose", () => ({ connect }));
    jest.doMock("../services/backup-service", () => ({ scheduleBackups: jest.fn() }));
    jest.doMock("mongoose", () => ({ connect, Schema: class Schema { index() {} }, model: jest.fn(() => ({})) }));
    jest.doMock("../config/env-config", () => ({ initEnv, getEnv }));
    jest.doMock("../utils/logger", () => ({
      logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn() },
      correlationIdMiddleware: "correlation",
      httpLoggerMiddleware: "http-logger",
      logStartupInfo,
      logDatabaseConnection,
    }));
    jest.doMock("../config/swagger", () => ({ setupSwagger }));
    jest.doMock("../routes/auth-routes", () => "auth-routes");
    jest.doMock("../routes/status-routes", () => "status-routes");
    jest.doMock("../routes/audit-routes", () => "audit-routes");
    jest.doMock("../routes/token-routes", () => "token-routes");
    jest.doMock("../routes/analytics-routes", () => "analytics-routes");
    jest.doMock("../routes/webhook-routes", () => "webhook-routes");
    jest.doMock("../routes/notification-routes", () => "notification-routes");
    jest.doMock("../routes/multisig-routes", () => "multisig-routes");
    jest.doMock("../routes/vault-routes", () => "vault-routes");
    jest.doMock("../routes/sponsorship-routes", () => "sponsorship-routes");
    jest.doMock("../routes/analytics-routes", () => "analytics-routes");
    jest.doMock("../middleware/security-headers", () => ({ securityHeaders: jest.fn((req, res, next) => next()) }));
    jest.doMock("../services/backup-service", () => ({ scheduleBackups: jest.fn() }));
    jest.doMock("../config/sentry", () => ({ initSentry: jest.fn() }));
    jest.doMock("../middleware/error-handler", () => ({
      errorHandler: "error-handler",
      notFoundHandler: "not-found-handler",
    }));

    const { startServer } = require("../index");
    await startServer();

    expect(initEnv).toHaveBeenCalled();
    expect(connect).toHaveBeenCalled();
    expect(setupSwagger).toHaveBeenCalledWith(expressApp);
    expect(use).toHaveBeenCalled();
    expect(options).toHaveBeenCalledWith("*", "cors-middleware");
    expect(listen).toHaveBeenCalledWith(5050, expect.any(Function));
    expect(logStartupInfo).toHaveBeenCalledWith(5050, "Test SDF Network ; September 2015");

    console.log.mockRestore();
  });
});
