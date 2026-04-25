const { getEnv } = require('../config/env-config');
const { logger } = require('../utils/logger');
const { getCacheService } = require('./cache-service');
const { getFeeSuggestions } = require('./fee-service');

/**
 * @title Fee Monitor Service
 * @description Background polling service to monitor network congestion and trigger alerts
 */

let monitorInterval = null;

const CACHE_KEY_ALERT = 'network_congestion_alert';

/**
 * @notice Check current network fees and determine congestion state
 */
const checkNetworkCongestion = async () => {
  try {
    const env = getEnv();
    const threshold = env.ALERT_FEE_THRESHOLD_STROOPS;

    // We can use getFeeSuggestions which internally calls fetchFeeStatsCached and returns p90
    // and whether the network is surging based on baseline.
    const suggestions = await getFeeSuggestions(1);

    const p90 = suggestions.percentiles?.p90 || 0;
    const baseFee = suggestions.baseFee;
    
    // It's congested if either the p90 fee is above the admin-configured absolute threshold
    // OR if the fee service considers it currently surging (p90 > 2 * baseFee)
    const isCongested = p90 > threshold || suggestions.surging;

    const alertPayload = {
      congested: isCongested,
      currentP90Fee: p90,
      baseFee: baseFee,
      threshold: threshold,
      timestamp: new Date().toISOString(),
      lastLedger: suggestions.lastLedger,
    };

    if (isCongested) {
      logger.warn('Network congestion detected', alertPayload);
    } else {
      logger.debug('Network fee status normal', alertPayload);
    }

    const cacheService = getCacheService();
    // Cache for slightly longer than the poll interval so it doesn't expire immediately if one poll misses
    const ttl = Math.ceil((env.FEE_MONITOR_INTERVAL_MS * 2) / 1000);
    
    await cacheService.set(CACHE_KEY_ALERT, alertPayload, ttl);
  } catch (error) {
    logger.error('Failed to check network congestion in background monitor', { error: error.message });
  }
};

/**
 * @notice Start the background fee monitor polling
 */
const startFeeMonitor = () => {
  if (monitorInterval) {
    logger.warn('Fee monitor is already running');
    return;
  }

  const env = getEnv();
  const intervalMs = env.FEE_MONITOR_INTERVAL_MS;

  logger.info(`Starting fee monitor service (interval: ${intervalMs}ms)`);
  
  // Run immediately once
  checkNetworkCongestion();

  // Then on interval
  monitorInterval = setInterval(checkNetworkCongestion, intervalMs);
};

/**
 * @notice Stop the background fee monitor polling
 */
const stopFeeMonitor = () => {
  if (monitorInterval) {
    clearInterval(monitorInterval);
    monitorInterval = null;
    logger.info('Fee monitor service stopped');
  }
};

module.exports = {
  startFeeMonitor,
  stopFeeMonitor,
  checkNetworkCongestion,
  CACHE_KEY_ALERT,
};
