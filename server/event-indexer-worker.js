require('dotenv').config();

const mongoose = require('mongoose');
const { initEnv, getEnv } = require('./config/env-config');
const { SorobanEventIndexer } = require('./services/event-indexer');
const { logger } = require('./utils/logger');

async function startIndexer() {
  try {
    initEnv();
    const env = getEnv();

    await mongoose.connect(env.MONGO_URI);
    logger.info('Event indexer connected to MongoDB');

    const indexer = new SorobanEventIndexer();
    await indexer.initialize();
    await indexer.start();

    process.on('SIGTERM', () => {
      logger.info('SIGTERM received, shutting down indexer');
      indexer.stop();
      mongoose.connection.close();
      process.exit(0);
    });

    process.on('SIGINT', () => {
      logger.info('SIGINT received, shutting down indexer');
      indexer.stop();
      mongoose.connection.close();
      process.exit(0);
    });

  } catch (error) {
    logger.error('Event indexer failed to start', { error: error.message });
    process.exit(1);
  }
}

startIndexer();
