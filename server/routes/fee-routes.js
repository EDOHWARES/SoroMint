const express = require('express');
const { asyncHandler } = require('../middleware/error-handler');
const { AppError } = require('../middleware/error-handler');
const { getRecommendedFee } = require('../services/fee-service');
const { logger } = require('../utils/logger');

const router = express.Router();

/**
 * @route GET /api/fees/recommended
 * @description Returns a recommended transaction fee based on current Horizon fee stats.
 *              Automatically applies a surge multiplier when network congestion is detected.
 * @access Public
 *
 * @param {number} [ops=1] - Number of operations in the transaction (query param)
 *
 * @returns {Object} 200 - Fee recommendation
 * @returns {Object} 400 - Invalid ops parameter
 * @returns {Object} 502 - Failed to fetch fee stats from Horizon
 */
router.get('/fees/recommended', asyncHandler(async (req, res) => {
  const rawOps = req.query.ops;
  const operationCount = rawOps !== undefined ? parseInt(rawOps, 10) : 1;

  if (isNaN(operationCount) || operationCount < 1 || operationCount > 100) {
    throw new AppError('ops must be an integer between 1 and 100', 400, 'INVALID_PARAMETER');
  }

  logger.info('Fee recommendation requested', {
    correlationId: req.correlationId,
    operationCount,
  });

  let recommendation;
  try {
    recommendation = await getRecommendedFee(operationCount);
  } catch (err) {
    logger.error('Failed to fetch fee stats from Horizon', { error: err.message });
    throw new AppError('Unable to fetch fee statistics from Horizon', 502, 'HORIZON_UNAVAILABLE');
  }

  res.json({
    success: true,
    data: recommendation,
  });
}));

module.exports = router;
