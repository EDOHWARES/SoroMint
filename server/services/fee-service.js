const { getEnv } = require('../config/env-config');
const { logger } = require('../utils/logger');

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

/**
 * @notice Fetches raw fee statistics from Horizon
 * @returns {Promise<Object>} Raw fee_stats response from Horizon
 */
const fetchFeeStats = async () => {
  const env = getEnv();
  const horizonUrl = env.HORIZON_URL || 'https://horizon-testnet.stellar.org';
  const url = `${horizonUrl}/fee_stats`;

  logger.info('Fetching fee stats from Horizon', { url });

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Horizon fee_stats request failed: ${response.status} ${response.statusText}`);
  }

  return response.json();
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
  const p50 = parseInt(feeStats.fee_charged?.p50 || BASE_FEE_STROOPS, 10);
  const p90 = parseInt(feeStats.fee_charged?.p90 || BASE_FEE_STROOPS, 10);
  const p99 = parseInt(feeStats.fee_charged?.p99 || BASE_FEE_STROOPS, 10);
  const baseFee = parseInt(feeStats.last_ledger_base_fee || BASE_FEE_STROOPS, 10);

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
 * @notice Main entry point — fetches stats and returns a fee recommendation
 * @param {number} operationCount - Number of operations in the transaction
 * @returns {Promise<Object>} Fee recommendation object
 */
const getRecommendedFee = async (operationCount = 1) => {
  const feeStats = await fetchFeeStats();
  const recommendation = computeRecommendedFee(feeStats, operationCount);

  logger.info('Fee recommendation computed', {
    surging: recommendation.surging,
    recommended: recommendation.recommended,
    operationCount,
  });

  return recommendation;
};

module.exports = {
  getRecommendedFee,
  computeRecommendedFee,
  isSurging,
  fetchFeeStats,
};
