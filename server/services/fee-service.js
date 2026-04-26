const { getEnv } = require('../config/env-config');
const { logger } = require('../utils/logger');
const { getCacheService } = require('./cache-service');

/**
 * @title FeeService
 * @notice Predicts recommended transaction fees on the Stellar network
 * @dev Fetches fee stats from Horizon's /fee_stats endpoint and computes
 *      a recommended fee based on current network congestion.
 */

// Surge multiplier applied when network is congested
const SURGE_MULTIPLIER = 1.5;

// Congestion threshold: if p90 fee is more than 2x the base fee, network is surging
const SURGE_THRESHOLD_RATIO = 2;

// Stellar base fee in stroops (100 stroops = 0.00001 XLM)
const BASE_FEE_STROOPS = 100;

// Cache fee_stats briefly to reduce Horizon load (fee stats update ~per ledger)
const FEE_STATS_CACHE_TTL_SECONDS = 10;

const parsePositiveInt = (value, fallback) => {
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const normalizeHorizonUrl = (url) => {
  if (!url) return url;
  return url.endsWith('/') ? url.slice(0, -1) : url;
};

/**
 * @notice Fetches raw fee statistics from Horizon
 * @returns {Promise<Object>} Raw fee_stats response from Horizon
 */
const fetchFeeStats = async () => {
  const env = getEnv();
  const horizonUrl = normalizeHorizonUrl(
    env.HORIZON_URL || 'https://horizon-testnet.stellar.org'
  );
  const url = `${horizonUrl}/fee_stats`;

  logger.info('Fetching fee stats from Horizon', { url });

  if (typeof fetch !== 'function') {
    throw new Error(
      'Global fetch is not available in this Node runtime (requires Node 18+)'
    );
  }

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Horizon fee_stats request failed: ${response.status} ${response.statusText}`);
  }

  return response.json();
};

/**
 * @notice Fetches fee statistics from Horizon with short-lived caching
 * @returns {Promise<Object>} Raw fee_stats response from Horizon
 */
const fetchFeeStatsCached = async () => {
  const env = getEnv();
  const horizonUrl = normalizeHorizonUrl(
    env.HORIZON_URL || 'https://horizon-testnet.stellar.org'
  );

  const cacheKey = `horizon:fee_stats:${horizonUrl}`;
  const cacheService = getCacheService();

  return cacheService.getOrSet(cacheKey, fetchFeeStats, {
    ttl: FEE_STATS_CACHE_TTL_SECONDS,
  });
};

/**
 * @notice Determines if the network is currently surging based on fee stats
 * @param {number} p90Fee - 90th percentile fee in stroops
 * @param {number} baseFee - Base fee in stroops
 * @returns {boolean} True if network is surging
 */
const isSurging = (p90Fee, baseFee) => {
  return p90Fee >= baseFee * SURGE_THRESHOLD_RATIO;
};

/**
 * @notice Computes the recommended fee for a given number of operations
 * @param {Object} feeStats - Raw fee stats from Horizon
 * @param {number} operationCount - Number of operations in the transaction (default: 1)
 * @returns {Object} Fee recommendation with surge info
 */
const computeRecommendedFee = (feeStats, operationCount = 1) => {
  const baseFee = parsePositiveInt(
    feeStats.last_ledger_base_fee,
    BASE_FEE_STROOPS
  );
  const p50 = parsePositiveInt(feeStats.fee_charged?.p50, baseFee);
  const p90 = parsePositiveInt(feeStats.fee_charged?.p90, baseFee);
  const p99 = parsePositiveInt(feeStats.fee_charged?.p99, baseFee);

  const surging = isSurging(p90, baseFee);

  // Under surge: use p90 * multiplier for high confidence inclusion
  // Normal: use p50 (median) — sufficient for most transactions
  const perOpFee = surging
    ? Math.ceil(p90 * SURGE_MULTIPLIER)
    : p50;

  const recommended = perOpFee * operationCount;

  return {
    recommended,        // total fee in stroops for the transaction
    perOperationFee: perOpFee,
    baseFee,
    percentiles: { p50, p90, p99 },
    surging,
    operationCount,
    lastLedger: feeStats.last_ledger,
    ledgerCapacityUsage: feeStats.ledger_capacity_usage,
  };
};

/**
 * @notice Computes low/medium/high fee suggestions for a transaction.
 * @dev For Soroban transactions, these values represent *inclusion fee* guidance
 *      (the classic `fee` field in stroops). Soroban resource fees should be
 *      added separately based on simulation results.
 *
 * @param {Object} feeStats - Raw fee stats from Horizon
 * @param {number} operationCount - Number of operations in the transaction (default: 1)
 * @returns {Object} Fee suggestions with surge info
 */
const computeFeeSuggestions = (feeStats, operationCount = 1) => {
  const baseFee = parsePositiveInt(
    feeStats.last_ledger_base_fee,
    BASE_FEE_STROOPS
  );

  const p10 = parsePositiveInt(feeStats.fee_charged?.p10, baseFee);
  const p50 = parsePositiveInt(feeStats.fee_charged?.p50, baseFee);
  const p90 = parsePositiveInt(feeStats.fee_charged?.p90, baseFee);
  const p99 = parsePositiveInt(feeStats.fee_charged?.p99, baseFee);

  const surging = isSurging(p90, baseFee);

  const perOpLow = Math.max(baseFee, p10);
  const perOpMedium = Math.max(baseFee, p50);
  const perOpHigh = Math.max(
    baseFee,
    surging ? Math.ceil(p90 * SURGE_MULTIPLIER) : p90
  );

  return {
    perOperationFee: {
      low: perOpLow,
      medium: perOpMedium,
      high: perOpHigh,
    },
    totalFee: {
      low: perOpLow * operationCount,
      medium: perOpMedium * operationCount,
      high: perOpHigh * operationCount,
    },
    baseFee,
    percentiles: { p10, p50, p90, p99 },
    surging,
    operationCount,
    lastLedger: feeStats.last_ledger,
    ledgerCapacityUsage: feeStats.ledger_capacity_usage,
  };
};

/**
 * @notice Main entry point — fetches stats and returns a fee recommendation
 * @param {number} operationCount - Number of operations in the transaction
 * @returns {Promise<Object>} Fee recommendation object
 */
const getRecommendedFee = async (operationCount = 1) => {
  const feeStats = await fetchFeeStatsCached();
  const recommendation = computeRecommendedFee(feeStats, operationCount);

  logger.info('Fee recommendation computed', {
    surging: recommendation.surging,
    recommended: recommendation.recommended,
    operationCount,
  });

  return recommendation;
};

/**
 * @notice Main entry point — fetches stats and returns low/medium/high fee suggestions
 * @param {number} operationCount - Number of operations in the transaction
 * @returns {Promise<Object>} Fee suggestions object
 */
const getFeeSuggestions = async (operationCount = 1) => {
  const feeStats = await fetchFeeStatsCached();
  const suggestions = computeFeeSuggestions(feeStats, operationCount);

  logger.info('Fee suggestions computed', {
    surging: suggestions.surging,
    operationCount,
    low: suggestions.totalFee.low,
    medium: suggestions.totalFee.medium,
    high: suggestions.totalFee.high,
  });

  return suggestions;
};

module.exports = {
  getRecommendedFee,
  getFeeSuggestions,
  computeRecommendedFee,
  computeFeeSuggestions,
  isSurging,
  fetchFeeStats,
  fetchFeeStatsCached,
};
