require('dotenv').config();

/**
 * @title SoroMint Server Entry Point
 * @description Main application entry point with environment validation
 * @notice Initializes the backend and registers all route modules
 */

const { initEnv, getEnv } = require('./config/env-config');
initEnv();

const { scheduleBackups } = require('./services/backup-service');
const { getCacheService } = require('./services/cache-service');
const { startReconciliationWorker } = require('./services/reconciliation-service');

const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const { securityHeaders } = require('./middleware/security-headers');
const { createCorsOptionsDelegate } = require('./config/cors-config');

const { initSentry } = require('./config/sentry');
const { errorHandler, notFoundHandler } = require('./middleware/error-handler');
const {
  logger,
  correlationIdMiddleware,
  httpLoggerMiddleware,
  logStartupInfo,
  logDatabaseConnection,
} = require('./utils/logger');
const { setupSwagger } = require('./config/swagger');
const { sampler } = require('./services/resource-sampler');
const authRoutes = require('./routes/auth-routes');
const statusRoutes = require('./routes/status-routes');
const auditRoutes = require('./routes/audit-routes');
const tokenRoutes = require('./routes/token-routes');
const feeRoutes = require('./routes/fee-routes');
const tokenSearchRoutes = require('./routes/token-search-routes');
const webhookRoutes = require('./routes/webhook-routes');
const analyticsRoutes = require('./routes/analytics-routes');
const notificationRoutes = require('./routes/notification-routes');
const votingRoutes = require('./routes/voting-routes');
const securityRoutes = require('./routes/security-routes');
const multiSigRoutes = require('./routes/multisig-routes');
const vaultRoutes = require('./routes/vault-routes');
const batchRoutes = require('./routes/batch-routes');
const referralRoutes = require('./routes/referral-routes');
const dividendRoutes = require('./routes/dividend-routes');
const streamingRoutes = require('./routes/streaming-routes');
const streamSearchRoutes = require('./routes/stream-search-routes');
const bridgeRoutes = require('./routes/bridge-routes');
const fraudDetectionRoutes = require('./routes/fraud-detection-routes');
const keyVaultRoutes = require('./routes/key-vault-routes');
const reconciliationRoutes = require('./routes/reconciliation-routes');
const FraudDetectionMiddleware = require('./middleware/fraud-detection');

const createApp = ({
  authRouter = authRoutes,
  tokenRouter = tokenRoutes,
  votingRouter = votingRoutes,
  securityRouter = securityRoutes,
} = {}) => {
  const app = express();
  const corsMiddleware = cors(createCorsOptionsDelegate());
  const fraudMiddleware = FraudDetectionMiddleware.getInstance();

  initSentry(app);
  app.use(securityHeaders);
  app.use(correlationIdMiddleware);
  app.use(httpLoggerMiddleware);
  app.use(corsMiddleware);
  app.options('*', corsMiddleware);
  app.use(express.json());

  // Initialize fraud detection middleware
  app.use(fraudMiddleware.monitorRateLimit({ windowMs: 60000, maxRequests: 50 }));
  app.use(fraudMiddleware.auditOperations());

  setupSwagger(app);

  app.use('/api', statusRoutes);
  app.use('/api', auditRoutes);
  app.use('/api', tokenRouter);
  app.use('/api', feeRoutes);
  app.use('/api', tokenSearchRoutes);
  app.use('/api', analyticsRoutes);
  app.use('/api', notificationRoutes);
  app.use('/api/auth', authRouter);
  app.use('/api', webhookRoutes);
  app.use('/api', votingRouter);
  app.use('/api', securityRouter);
  app.use('/api/multisig', multiSigRoutes);
  app.use('/api/vault', vaultRoutes);
  app.use('/api', batchRoutes);
  app.use('/api/referrals', referralRoutes);
  app.use('/api', dividendRoutes);
  app.use('/api/streaming', streamingRoutes);
  app.use('/api/streaming', streamSearchRoutes);
  app.use('/api/bridge', bridgeRoutes);
  app.use('/api/fraud-detection', fraudDetectionRoutes);
  app.use('/api/key-vault', keyVaultRoutes);
  app.use('/api/reconciliation', reconciliationRoutes);

  // Apply streaming fraud detection middleware
  app.use('/api/streaming', fraudMiddleware.monitorStreamingOperations());

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
    logger.info('Cache service initialized successfully');
  } catch (error) {
    logger.warn(
      'Cache service initialization failed, continuing without cache',
      {
        error: error.message,
      }
    );
  }

  await connectDatabase();
  const app = createApp();

  const { initSocket } = require('./utils/socket');

  const server = app.listen(env.PORT, () => {
    logStartupInfo(env.PORT, env.NETWORK_PASSPHRASE);
    sampler.start();
    logger.info('Server listening', {
      port: env.PORT,
      url: `http://localhost:${env.PORT}`,
      docsUrl: `http://localhost:${env.PORT}/api-docs`,
    });
    scheduleBackups();
    startReconciliationWorker();
  });

  initSocket(server);
};

if (require.main === module) {
  startServer().catch((error) => {
    logger.error('Server failed to start', { error });
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
