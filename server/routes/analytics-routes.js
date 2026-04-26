/**
 * @title Analytics Routes
 * @description Exposes endpoints for blockchain analytics data export and
 *   on-demand sync to external platforms (Dune, Bubble, webhooks).
 *   All responses are privacy-compliant — no PII is returned.
 */

const express = require('express');
const { asyncHandler } = require('../middleware/error-handler');
const { authenticate } = require('../middleware/auth');
const {
  syncAnalytics,
  buildAnalyticsPayload,
  getTransferAggregation,
  getHolderDistribution,
  getVolumeMetrics,
  getTokensMetrics,
} = require('../services/analytics-service');
const { logger } = require('../utils/logger');

const router = express.Router();

/**
 * @route GET /api/analytics/export
 * @description Returns a privacy-safe analytics snapshot (tokens + deployment activity).
 *   Suitable for embedding in third-party dashboards.
 * @security JWT
 * @returns {Object} 200 - Analytics payload
 */
router.get(
  '/analytics/export',
  authenticate,
  asyncHandler(async (req, res) => {
    logger.info('Analytics export requested', {
      correlationId: req.correlationId,
    });
    const payload = await buildAnalyticsPayload();
    res.json({ success: true, data: payload });
  })
);

/**
 * @route POST /api/analytics/sync
 * @description Triggers an on-demand sync of analytics data to all configured
 *   external platforms (Dune, Bubble webhook, etc.).
 * @security JWT
 * @returns {Object} 200 - Sync result per platform
 */
router.post(
  '/analytics/sync',
  authenticate,
  asyncHandler(async (req, res) => {
    logger.info('Analytics sync triggered', {
      correlationId: req.correlationId,
    });
    const result = await syncAnalytics();
    res.json({ success: true, data: result });
  })
);

/**
 * @route GET /api/analytics/transfers
 * @description Aggregates transfer data for all tokens minted via the platform.
 *   Returns transfer counts, unique transferers, and total volumes per token.
 * @security JWT
 * @returns {Object} 200 - Transfer aggregation data
 */
router.get(
  '/analytics/transfers',
  authenticate,
  asyncHandler(async (req, res) => {
    logger.info('Transfer aggregation requested', {
      correlationId: req.correlationId,
    });
    const data = await getTransferAggregation();
    res.json({ success: true, data });
  })
);

/**
 * @route GET /api/analytics/holders
 * @description Returns holder distribution data for all tokens.
 *   Shows unique holders per token and platform-wide holder metrics.
 * @security JWT
 * @returns {Object} 200 - Holder distribution data
 */
router.get(
  '/analytics/holders',
  authenticate,
  asyncHandler(async (req, res) => {
    logger.info('Holder distribution requested', {
      correlationId: req.correlationId,
    });
    const data = await getHolderDistribution();
    res.json({ success: true, data });
  })
);

/**
 * @route GET /api/analytics/volume
 * @description Returns volume metrics for all tokens including 24h, 7d, and 30d volumes.
 *   Optional query parameter 'days' controls the analysis period (default: 30).
 * @security JWT
 * @query {number} [days=30] - Number of days to analyze
 * @returns {Object} 200 - Volume metrics data
 */
router.get(
  '/analytics/volume',
  authenticate,
  asyncHandler(async (req, res) => {
    const { days = 30 } = req.query;
    const daysNum = Math.max(1, Math.min(365, parseInt(days, 10) || 30));
    logger.info('Volume metrics requested', {
      correlationId: req.correlationId,
      days: daysNum,
    });
    const data = await getVolumeMetrics(daysNum);
    res.json({ success: true, data });
  })
);

/**
 * @route GET /api/analytics/metrics
 * @description Comprehensive token metrics combining transfers, holders, and volume data.
 *   Provides a complete platform analytics snapshot.
 *   Optional query parameter 'days' controls volume analysis period (default: 30).
 * @security JWT
 * @query {number} [days=30] - Number of days for volume analysis
 * @returns {Object} 200 - Comprehensive token metrics
 */
router.get(
  '/analytics/metrics',
  authenticate,
  asyncHandler(async (req, res) => {
    const { days = 30 } = req.query;
    const daysNum = Math.max(1, Math.min(365, parseInt(days, 10) || 30));
    logger.info('Comprehensive metrics requested', {
      correlationId: req.correlationId,
      days: daysNum,
    });
    const data = await getTokensMetrics(daysNum);
    res.json({ success: true, data });
  })
);

module.exports = router;
