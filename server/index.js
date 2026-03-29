require("dotenv").config();

/**
 * @title SoroMint Server Entry Point
 * @description Main application entry point with environment validation
 * @notice Initializes the backend and registers all route modules
 */

const { initEnv, getEnv } = require("./config/env-config");
initEnv();

const { scheduleBackups } = require("./services/backup-service");

const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const { securityHeaders } = require("./middleware/security-headers");

const { errorHandler, notFoundHandler } = require("./middleware/error-handler");
const {
  logger,
  correlationIdMiddleware,
  httpLoggerMiddleware,
  logStartupInfo,
  logDatabaseConnection,
} = require("./utils/logger");
const { setupSwagger } = require("./config/swagger");
const authRoutes = require("./routes/auth-routes");
const statusRoutes = require("./routes/status-routes");
const auditRoutes = require("./routes/audit-routes");
const tokenRoutes = require("./routes/token-routes");
const analyticsRoutes = require("./routes/analytics-routes");

const createApp = ({ authRouter = authRoutes, tokenRouter = tokenRoutes } = {}) => {
  const app = express();

  app.use(securityHeaders);
  app.use(cors());
  app.use(express.json());

  app.use(correlationIdMiddleware);
  app.use(httpLoggerMiddleware);

  setupSwagger(app);

  app.use("/api", statusRoutes);
  app.use("/api", auditRoutes);
  app.use("/api", tokenRouter);
  app.use("/api", analyticsRoutes);
  app.use("/api/auth", authRouter);

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
  await connectDatabase();
  const app = createApp();

  app.listen(env.PORT, () => {
    logStartupInfo(env.PORT, env.NETWORK_PASSPHRASE);
    console.log(`Server running on http://localhost:${env.PORT}`);
    console.log(`API Documentation available at http://localhost:${env.PORT}/api-docs`);
    scheduleBackups();
  });
};

if (require.main === module) {
  startServer().catch((error) => {
    logger.error("Server failed to start", { error: error.message });
    process.exit(1);
  });
}

module.exports = {
  createApp,
  connectDatabase,
  startServer,
};
