require("dotenv").config();

/**
 * @title SoroMint Server Entry Point
 * @description Main application entry point with environment validation
 * @notice Initializes the backend and registers all route modules
 */

const { initEnv, getEnv } = require("./config/env-config");
initEnv();

const { scheduleBackups } = require("./services/backup-service");
const { getCacheService } = require("./services/cache-service");

const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const { securityHeaders } = require("./middleware/security-headers");
const { createCorsOptionsDelegate } = require("./config/cors-config");

const { initSentry } = require("./config/sentry");
const { errorHandler, notFoundHandler } = require("./middleware/error-handler");
const {
  logger,
  correlationIdMiddleware,
  httpLoggerMiddleware,
  logStartupInfo,
  logDatabaseConnection,
} = require("./utils/logger");
const { setupSwagger } = require("./config/swagger");
const { sampler } = require("./services/resource-sampler");
const authRoutes = require("./routes/auth-routes");
const statusRoutes = require("./routes/status-routes");
const auditRoutes = require("./routes/audit-routes");
const tokenRoutes = require("./routes/token-routes");
const webhookRoutes = require("./routes/webhook-routes");
const analyticsRoutes = require("./routes/analytics-routes");
const notificationRoutes = require("./routes/notification-routes");

const createApp = ({ authRouter = authRoutes, tokenRouter = tokenRoutes } = {}) => {
  const app = express();
  const corsMiddleware = cors(createCorsOptionsDelegate());

  initSentry(app);
  app.use(securityHeaders);
  app.use(correlationIdMiddleware);
  app.use(httpLoggerMiddleware);
  app.use(corsMiddleware);
  app.options("*", corsMiddleware);
  app.use(express.json());

  setupSwagger(app);

  app.use("/api", statusRoutes);
  app.use("/api", auditRoutes);
  app.use("/api", tokenRouter);
  app.use("/api", analyticsRoutes);
  app.use("/api", notificationRoutes);
  app.use("/api/auth", authRouter);
  app.use("/api", webhookRoutes);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
};

const connectDatabase = async () => {
  const env = getEnv();

  try {
    await mongoose.connect(env.MONGO_URI);
    logDatabaseConnection(true);
  } catch (error) {
    logDatabaseConnection(false, error);
    throw error;
  }
};

const startServer = async () => {
  const env = getEnv();

  // Initialize cache service
  const cacheService = getCacheService();
  try {
    await cacheService.initialize();
    logger.info("Cache service initialized successfully");
  } catch (error) {
    logger.warn("Cache service initialization failed, continuing without cache", {
      error: error.message,
    });
  }

  await connectDatabase();
  const app = createApp();

  app.listen(env.PORT, () => {
    logStartupInfo(env.PORT, env.NETWORK_PASSPHRASE);
    sampler.start();
    console.log(`Server running on http://localhost:${env.PORT}`);
    console.log(`API Documentation available at http://localhost:${env.PORT}/api-docs`);
    scheduleBackups();
  });
};

if (require.main === module) {
  startServer().catch((error) => {
    logger.error("Server failed to start", { error: error.message });
    setImmediate(() => {
      throw error;
    });
  });
}

module.exports = {
  createApp,
  connectDatabase,
  startServer,
};
