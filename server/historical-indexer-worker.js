require('dotenv').config();

const mongoose = require('mongoose');
const StellarSdk = require('@stellar/stellar-sdk');
const { initEnv, getEnv } = require('./config/env-config');
const SorobanEvent = require('./models/SorobanEvent');
const { logger } = require('./utils/logger');

const BATCH_SIZE = 1000;
const RETRY_DELAY_MS = 5000;

async function runHistoricalIndexer() {
  try {
    initEnv();
    const env = getEnv();

    await mongoose.connect(env.MONGO_URI);
    logger.info('Historical indexer connected to MongoDB');

    const rpcUrl = env.SOROBAN_RPC_URLS?.split(',')[0] || env.SOROBAN_RPC_URL;
    const server = new StellarSdk.SorobanRpc.Server(rpcUrl);

    let startLedger = env.INDEXER_START_LEDGER;
    if (!startLedger) {
      logger.error('INDEXER_START_LEDGER is not defined in environment');
      process.exit(1);
    }

    logger.info(`Starting historical event rebuild from ledger ${startLedger}`);

    let currentCursor = null;
    let processedCount = 0;

    while (true) {
      try {
        const request = {
          filters: [],
          pagination: { limit: BATCH_SIZE }
        };

        if (currentCursor) {
          request.pagination.cursor = currentCursor;
        } else {
          request.startLedger = startLedger;
        }

        const response = await server.getEvents(request);

        if (!response.events || response.events.length === 0) {
          logger.info(`No more events found. Rebuild complete. Processed ${processedCount} events. Latest network ledger: ${response.latestLedger}`);
          break;
        }

        const events = response.events.map(e => ({
          contractId: e.contractId,
          eventType: e.topic?.[0] || 'unknown',
          ledger: e.ledger,
          ledgerClosedAt: new Date(e.ledgerClosedAt),
          txHash: e.txHash,
          topics: e.topic || [],
          value: e.value,
          pagingToken: e.pagingToken,
          inSuccessfulContractCall: e.inSuccessfulContractCall ?? true,
        }));

        // Insert idempotently
        await SorobanEvent.insertMany(events, { ordered: false }).catch(err => {
          if (err.code !== 11000) throw err; // Ignore duplicate key errors
        });

        processedCount += events.length;
        currentCursor = events[events.length - 1].pagingToken;

        logger.info(`Indexed historical batch`, {
          batchSize: events.length,
          totalProcessed: processedCount,
          lastLedger: events[events.length - 1].ledger
        });

        // If the batch returned fewer events than the limit, we might be caught up.
        // But to be safe, we loop until it returns 0.

      } catch (error) {
        logger.error('Error fetching historical events, retrying...', { error: error.message });
        await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS));
      }
    }

    logger.info('Historical database rebuild finished successfully');
    await mongoose.connection.close();
    process.exit(0);

  } catch (error) {
    logger.error('Historical indexer failed', { error: error.message });
    process.exit(1);
  }
}

runHistoricalIndexer();
