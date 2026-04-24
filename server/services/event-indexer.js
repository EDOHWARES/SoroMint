const StellarSdk = require('@stellar/stellar-sdk');
const SorobanEvent = require('../models/SorobanEvent');
const { logger } = require('../utils/logger');
const { getEnv } = require('../config/env-config');

const BATCH_SIZE = 100;
const POLL_INTERVAL_MS = 5000;
const RECONNECT_DELAY_MS = 10000;

class SorobanEventIndexer {
  constructor() {
    this.server = null;
    this.isRunning = false;
    this.lastCursor = null;
    this.processingBatch = false;
  }

  async initialize() {
    const env = getEnv();
    const rpcUrl = env.SOROBAN_RPC_URLS?.split(',')[0] || env.SOROBAN_RPC_URL;
    this.server = new StellarSdk.SorobanRpc.Server(rpcUrl);
    
    const lastEvent = await SorobanEvent.findOne().sort({ ledger: -1 });
    this.lastCursor = lastEvent?.pagingToken || undefined;
    
    logger.info('SorobanEventIndexer initialized', { 
      rpcUrl, 
      startCursor: this.lastCursor || 'genesis' 
    });
  }

  async start() {
    if (this.isRunning) return;
    this.isRunning = true;
    logger.info('SorobanEventIndexer started');
    this._poll();
  }

  stop() {
    this.isRunning = false;
    logger.info('SorobanEventIndexer stopped');
  }

  async _poll() {
    while (this.isRunning) {
      try {
        await this._fetchAndIndexEvents();
        await this._sleep(POLL_INTERVAL_MS);
      } catch (error) {
        logger.error('Event indexing error', { error: error.message });
        await this._sleep(RECONNECT_DELAY_MS);
      }
    }
  }

  async _fetchAndIndexEvents() {
    if (this.processingBatch) return;
    this.processingBatch = true;

    try {
      const request = {
        filters: [],
        pagination: { limit: BATCH_SIZE },
      };

      if (this.lastCursor) {
        request.startLedger = parseInt(this.lastCursor.split('-')[0]) + 1;
      }

      const response = await this.server.getEvents(request);
      
      if (!response.events || response.events.length === 0) {
        return;
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

      await SorobanEvent.insertMany(events, { ordered: false }).catch(err => {
        if (err.code !== 11000) throw err;
      });

      this.lastCursor = events[events.length - 1].pagingToken;
      
      logger.info('Indexed events batch', { 
        count: events.length, 
        lastLedger: events[events.length - 1].ledger 
      });
    } finally {
      this.processingBatch = false;
    }
  }

  _sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

module.exports = { SorobanEventIndexer };
