/**
 * @title Analytics Routes
 * @description Exposes endpoints for blockchain analytics data export and
 *   on-demand sync to external platforms (Dune, Bubble, webhooks).
 *   All responses are privacy-compliant — no PII is returned.
 */

const express = require("express");
const { asyncHandler } = require("../middleware/error-handler");
const { authenticate } = require("../middleware/auth");
const { syncAnalytics, buildAnalyticsPayload } = require("../services/analytics-service");
const { logger } = require("../utils/logger");

const router = express.Router();

/**
 * @route GET /api/analytics/export
 * @description Returns a privacy-safe analytics snapshot (tokens + deployment activity).
 *   Suitable for embedding in third-party dashboards.
 * @security JWT
 * @returns {Object} 200 - Analytics payload
 */
router.get(
  "/analytics/export",
  authenticate,
  asyncHandler(async (req, res) => {
    logger.info("Analytics export requested", { correlationId: req.correlationId });
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
  "/analytics/sync",
  authenticate,
  asyncHandler(async (req, res) => {
    logger.info("Analytics sync triggered", { correlationId: req.correlationId });
    const result = await syncAnalytics();
    res.json({ success: true, data: result });
  })
);

module.exports = router;
