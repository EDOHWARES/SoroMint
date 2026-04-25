'use strict';

const express = require('express');
const { asyncHandler } = require('../middleware/error-handler');
const { AppError } = require('../middleware/error-handler');
const { getRecommendedFee, getFeeSuggestions } = require('../services/fee-service');
const { logger } = require('../utils/logger');

const router = express.Router();

/**
 * @openapi
 * @route GET /api/fees/recommended
 * @name getRecommendedFee
 * @description Returns a recommended transaction fee based on current Horizon fee stats with automatic surge multiplier
 * @tags Analytics
 * @param {integer} ops - Number of operations in the transaction (optional, default: 1, max: 100)
 * @returns {object} 200 - Fee recommendation
 * @returns {object} 400 - Invalid ops parameter
 * @returns {object} 502 - Failed to fetch fee stats from Horizon
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

/**
 * @openapi
 * @route GET /api/fees/suggestions
 * @name getFeeSuggestions
 * @description Returns low/medium/high fee suggestions based on current Horizon fee stats. For Soroban transactions, these represent inclusion-fee guidance.
 * @tags Analytics
 * @param {integer} ops - Number of operations in the transaction (optional, default: 1, max: 100)
 * @returns {object} 200 - Fee suggestions (low, medium, high)
 * @returns {object} 400 - Invalid ops parameter
 * @returns {object} 502 - Failed to fetch fee stats from Horizon
 */
router.get('/fees/suggestions', asyncHandler(async (req, res) => {
  const rawOps = req.query.ops;
  const operationCount = rawOps !== undefined ? parseInt(rawOps, 10) : 1;

  if (isNaN(operationCount) || operationCount < 1 || operationCount > 100) {
    throw new AppError('ops must be an integer between 1 and 100', 400, 'INVALID_PARAMETER');
  }

  logger.info('Fee suggestions requested', {
    correlationId: req.correlationId,
    operationCount,
  });

  let suggestions;
  try {
    suggestions = await getFeeSuggestions(operationCount);
  } catch (err) {
    logger.error('Failed to fetch fee stats from Horizon', { error: err.message });
    throw new AppError('Unable to fetch fee statistics from Horizon', 502, 'HORIZON_UNAVAILABLE');
  }

  res.json({
    success: true,
    data: suggestions,
  });
}));

module.exports = router;
