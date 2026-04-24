/**
 * @title Bridge API Routes
 * @description Routes for bridge relayer control and event ingestion
 * @notice Handles bridge status, event simulation, relayer start/stop
 */

const express = require("express");
const { authenticate } = require("../middleware/auth");
const { asyncHandler } = require("../middleware/error-handler");
const { getBridgeRelayer } = require("../services/bridge-relayer");
const {
  validateBridgeEvent,
  validateBridgeStatus,
} = require("../validators/bridge-validator");
const { logger } = require("../utils/logger");

const router = express.Router();

/**
 * @route GET /api/bridge/relayer/status
 * @description Returns the current bridge relayer status and queue metrics
 * @access Private (JWT)
 */
router.get(
  "/bridge/relayer/status",
  authenticate,
  validateBridgeStatus,
  asyncHandler(async (req, res) => {
    const relayer = getBridgeRelayer();
    const detailed = req.query.detailed === true || req.query.detailed === "true";

    let status = relayer.getStatus();

    if (!detailed && status.originalEvent) {
      delete status.originalEvent;
    }

    logger.info("Bridge relayer status retrieved", {
      correlationId: req.correlationId,
      userId: req.user?._id,
      enabled: status.enabled,
      configured: status.configured,
    });

    res.json({ success: true, data: status });
  }),
);

/**
 * @route POST /api/bridge/relayer/start
 * @description Starts the relayer watchers and polling loops
 * @access Private (JWT)
 */
router.post(
  "/bridge/relayer/start",
  authenticate,
  asyncHandler(async (req, res) => {
    const relayer = getBridgeRelayer();

    if (!relayer.isConfigured()) {
      return res.status(400).json({
        success: false,
        error: "Bridge relayer is not properly configured",
        details: "Missing required environment variables",
      });
    }

    try {
      const status = await relayer.start();

      logger.info("Bridge relayer started", {
        correlationId: req.correlationId,
        userId: req.user?._id,
        direction: status.direction,
      });

      res.status(202).json({ success: true, data: status });
    } catch (error) {
      logger.error("Failed to start bridge relayer", {
        correlationId: req.correlationId,
        error: error.message,
        userId: req.user?._id,
      });

      res.status(500).json({
        success: false,
        error: "Failed to start bridge relayer",
        details: error.message,
      });
    }
  }),
);

/**
 * @route POST /api/bridge/relayer/stop
 * @description Stops all relayer watchers and polling loops
 * @access Private (JWT)
 */
router.post(
  "/bridge/relayer/stop",
  authenticate,
  asyncHandler(async (req, res) => {
    const relayer = getBridgeRelayer();

    try {
      const status = await relayer.stop();

      logger.info("Bridge relayer stopped", {
        correlationId: req.correlationId,
        userId: req.user?._id,
      });

      res.json({ success: true, data: status });
    } catch (error) {
      logger.error("Failed to stop bridge relayer", {
        correlationId: req.correlationId,
        error: error.message,
        userId: req.user?._id,
      });

      res.status(500).json({
        success: false,
        error: "Failed to stop bridge relayer",
        details: error.message,
      });
    }
  }),
);

/**
 * @route POST /api/bridge/relayer/simulate
 * @description Injects a Soroban or EVM event into the relayer for dry-run testing
 * @access Private (JWT)
 */
router.post(
  "/bridge/relayer/simulate",
  authenticate,
  validateBridgeEvent,
  asyncHandler(async (req, res) => {
    const relayer = getBridgeRelayer();

    if (!relayer.enabled) {
      return res.status(400).json({
        success: false,
        error: "Bridge relayer is not enabled",
      });
    }

    try {
      const command = await relayer.ingestEvent(
        req.body.sourceChain,
        req.body.event,
        {
          metadata: req.body.metadata,
          actor: req.user?.publicKey || null,
        },
      );

      logger.info("Bridge event simulated", {
        correlationId: req.correlationId,
        userId: req.user?._id,
        sourceChain: req.body.sourceChain,
        commandBuilt: !!command,
      });

      res.status(command ? 202 : 200).json({
        success: true,
        data: {
          command,
          status: relayer.getStatus(),
        },
      });
    } catch (error) {
      logger.error("Failed to simulate bridge event", {
        correlationId: req.correlationId,
        error: error.message,
        userId: req.user?._id,
      });

      res.status(500).json({
        success: false,
        error: "Failed to simulate bridge event",
        details: error.message,
      });
    }
  }),
);

/**
 * @route POST /api/bridge/relayer/ingest
 * @description Production endpoint for ingesting events from external sources
 * @description Should be called by actual event watchers in production
 * @access Private (JWT)
 */
router.post(
  "/bridge/relayer/ingest",
  authenticate,
  validateBridgeEvent,
  asyncHandler(async (req, res) => {
    const relayer = getBridgeRelayer();

    if (!relayer.enabled) {
      return res.status(202).json({
        success: true,
        data: { 
          command: null, 
          reason: "Relayer disabled" 
        },
      });
    }

    try {
      const command = await relayer.ingestEvent(
        req.body.sourceChain,
        req.body.event,
        {
          metadata: req.body.metadata,
          actor: req.user?.publicKey || null,
        },
      );

      if (command) {
        logger.debug("Bridge event ingested and queued", {
          correlationId: req.correlationId,
          bridgeId: command.bridgeId,
          sourceChain: command.sourceChain,
          targetChain: command.targetChain,
        });
      } else {
        logger.debug("Bridge event skipped during normalization", {
          correlationId: req.correlationId,
          sourceChain: req.body.sourceChain,
        });
      }

      res.status(202).json({
        success: true,
        data: {
          command,
          status: relayer.getStatus(),
        },
      });
    } catch (error) {
      logger.error("Failed to ingest bridge event", {
        correlationId: req.correlationId,
        error: error.message,
        userId: req.user?._id,
      });

      // Still return 202 to prevent event replay issues
      res.status(202).json({
        success: false,
        error: "Failed to ingest bridge event",
        details: error.message,
      });
    }
  }),
);

/**
 * @route POST /api/bridge/relayer/reset
 * @description Resets the relayer queue and stats (admin only)
 * @access Private (JWT) - Admin only
 */
router.post(
  "/bridge/relayer/reset",
  authenticate,
  asyncHandler(async (req, res) => {
    const relayer = getBridgeRelayer();

    // Simple admin check - in production, use role-based access control
    const isAdmin = req.user?.role === "admin" || req.user?.isAdmin;

    if (!isAdmin) {
      return res.status(403).json({
        success: false,
        error: "Only administrators can reset the bridge relayer",
      });
    }

    try {
      relayer.queue = [];
      relayer.stats = {
        observed: 0,
        skipped: 0,
        relayed: 0,
        failed: 0,
        lastObservedAt: null,
        lastRelayedAt: null,
        lastError: null,
      };

      logger.warn("Bridge relayer reset by admin", {
        correlationId: req.correlationId,
        userId: req.user?._id,
      });

      res.json({
        success: true,
        data: relayer.getStatus(),
      });
    } catch (error) {
      logger.error("Failed to reset bridge relayer", {
        correlationId: req.correlationId,
        error: error.message,
        userId: req.user?._id,
      });

      res.status(500).json({
        success: false,
        error: "Failed to reset bridge relayer",
        details: error.message,
      });
    }
  }),
);

module.exports = router;
