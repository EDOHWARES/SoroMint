require('dotenv').config();
const mongoose = require('mongoose');
const { initEnv, getEnv } = require('./config/env-config');
const scheduledStreamService = require('./services/scheduled-stream-service');
const { logger } = require('./utils/logger');
const { SorobanRpc } = require('@stellar/stellar-sdk');

async function startWorker() {
  try {
    initEnv();
    const env = getEnv();

    await mongoose.connect(env.MONGO_URI);
    logger.info('Scheduled stream worker connected to MongoDB');

    const rpcServer = new SorobanRpc.Server(env.SOROBAN_RPC_URL);

    // Run every 30 seconds
    const interval = 30000;
    
    logger.info(`Scheduled stream worker started (interval: ${interval}ms)`);

    const process = async () => {
      try {
        // Get current ledger sequence
        const networkInfo = await rpcServer.getLatestLedger();
        const currentLedger = networkInfo.sequence;
        
        logger.debug(`Current ledger: ${currentLedger}. Checking for scheduled streams...`);
        
        await scheduledStreamService.processScheduledStreams(currentLedger);
      } catch (error) {
        logger.error('Error in scheduled stream worker loop', { error: error.message });
      }
      
      setTimeout(process, interval);
    };

    process();

    // Handle shutdown
    const shutdown = async (signal) => {
      logger.info(`${signal} received, shutting down scheduled stream worker`);
      await mongoose.connection.close();
      process.exit(0);
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));

  } catch (error) {
    logger.error('Scheduled stream worker failed to start', { error: error.message });
    process.exit(1);
  }
}

if (require.main === module) {
  startWorker();
}

module.exports = startWorker;
