'use strict';

const express = require('express');
const { authenticate } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/error-handler');
const { getBridgeRelayer } = require('../services/bridge-relayer');
const {
  validateBridgeEvent,
  validateBridgeStatus,
} = require('../validators/bridge-validator');
const { logger } = require('../utils/logger');

const router = express.Router();

/**
 * @openapi
 * @route GET /api/bridge/relayer/status
 * @name getBridgeRelayerStatus
 * @description Returns the current bridge relayer status and queue metrics
 * @tags Bridge
 * @security BearerAuth
 * @param {boolean} detailed - Include full event details in response (optional)
 * @returns {object} 200 - Bridge relayer status data
 */
router.get(
  '/bridge/relayer/status',
  authenticate,
  validateBridgeStatus,
  asyncHandler(async (req, res) => {
    const relayer = getBridgeRelayer();
    const detailed = req.query.detailed === true || req.query.detailed === 'true';

    let status = relayer.getStatus();

    if (!detailed && status.originalEvent) {
      delete status.originalEvent;
    }

    logger.info('Bridge relayer status retrieved', {
      correlationId: req.correlationId,
      userId: req.user?._id,
      enabled: status.enabled,
      configured: status.configured,
    });

    res.json({ success: true, data: status });
  }),
);

/**
 * @openapi
 * @route POST /api/bridge/relayer/start
 * @name startBridgeRelayer
 * @description Starts the relayer watchers and polling loops
 * @tags Bridge
 * @security BearerAuth
 * @returns {object} 202 - Relayer started successfully
 * @returns {object} 400 - Relayer not properly configured
 * @returns {object} 500 - Failed to start relayer
 */
router.post(
  '/bridge/relayer/start',
  authenticate,
  asyncHandler(async (req, res) => {
    const relayer = getBridgeRelayer();

    if (!relayer.isConfigured()) {
      return res.status(400).json({
        success: false,
        error: 'Bridge relayer is not properly configured',
        details: 'Missing required environment variables',
      });
    }

    try {
      const status = await relayer.start();

      logger.info('Bridge relayer started', {
        correlationId: req.correlationId,
        userId: req.user?._id,
        direction: status.direction,
      });

      res.status(202).json({ success: true, data: status });
    } catch (error) {
      logger.error('Failed to start bridge relayer', {
        correlationId: req.correlationId,
        error: error.message,
        userId: req.user?._id,
      });

      res.status(500).json({
        success: false,
        error: 'Failed to start bridge relayer',
        details: error.message,
      });
    }
  }),
);

/**
 * @openapi
 * @route POST /api/bridge/relayer/stop
 * @name stopBridgeRelayer
 * @description Stops all relayer watchers and polling loops
 * @tags Bridge
 * @security BearerAuth
 * @returns {object} 200 - Relayer stopped successfully
 * @returns {object} 500 - Failed to stop relayer
 */
router.post(
  '/bridge/relayer/stop',
  authenticate,
  asyncHandler(async (req, res) => {
    const relayer = getBridgeRelayer();

    try {
      const status = await relayer.stop();

      logger.info('Bridge relayer stopped', {
        correlationId: req.correlationId,
        userId: req.user?._id,
      });

      res.json({ success: true, data: status });
    } catch (error) {
      logger.error('Failed to stop bridge relayer', {
        correlationId: req.correlationId,
        error: error.message,
        userId: req.user?._id,
      });

      res.status(500).json({
        success: false,
        error: 'Failed to stop bridge relayer',
        details: error.message,
      });
    }
  }),
);

/**
 * @openapi
 * @route POST /api/bridge/relayer/simulate
 * @name simulateBridgeEvent
 * @description Injects a Soroban or EVM event into the relayer for dry-run testing
 * @tags Bridge
 * @security BearerAuth
 * @param {string} sourceChain - Source chain identifier (e.g., ethereum, stellar)
 * @param {object} event - Event payload to simulate
 * @param {object} metadata - Optional metadata for the event
 * @returns {object} 200 - Simulation completed (no command built)
 * @returns {object} 202 - Simulation completed with command built
 * @returns {object} 400 - Relayer not enabled
 * @returns {object} 500 - Simulation failed
 */
router.post(
  '/bridge/relayer/simulate',
  authenticate,
  validateBridgeEvent,
  asyncHandler(async (req, res) => {
    const relayer = getBridgeRelayer();

    if (!relayer.enabled) {
      return res.status(400).json({
        success: false,
        error: 'Bridge relayer is not enabled',
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

      logger.info('Bridge event simulated', {
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
      logger.error('Failed to simulate bridge event', {
        correlationId: req.correlationId,
        error: error.message,
        userId: req.user?._id,
      });

      res.status(500).json({
        success: false,
        error: 'Failed to simulate bridge event',
        details: error.message,
      });
    }
  }),
);

/**
 * @openapi
 * @route POST /api/bridge/relayer/ingest
 * @name ingestBridgeEvent
 * @description Production endpoint for ingesting events from external sources
 * @tags Bridge
 * @security BearerAuth
 * @param {string} sourceChain - Source chain identifier
 * @param {object} event - Event payload to ingest
 * @param {object} metadata - Optional metadata for the event
 * @returns {object} 202 - Event processed (accepted even on partial failure)
 * @returns {object} 400 - Relayer not enabled
 */
router.post(
  '/bridge/relayer/ingest',
  authenticate,
  validateBridgeEvent,
  asyncHandler(async (req, res) => {
    const relayer = getBridgeRelayer();

    if (!relayer.enabled) {
      return res.status(202).json({
        success: true,
        data: {
          command: null,
          reason: 'Relayer disabled',
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
        logger.debug('Bridge event ingested and queued', {
          correlationId: req.correlationId,
          bridgeId: command.bridgeId,
          sourceChain: command.sourceChain,
          targetChain: command.targetChain,
        });
      } else {
        logger.debug('Bridge event skipped during normalization', {
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
      logger.error('Failed to ingest bridge event', {
        correlationId: req.correlationId,
        error: error.message,
        userId: req.user?._id,
      });

      res.status(202).json({
        success: false,
        error: 'Failed to ingest bridge event',
        details: error.message,
      });
    }
  }),
);

/**
 * @openapi
 * @route POST /api/bridge/relayer/reset
 * @name resetBridgeRelayer
 * @description Resets the relayer queue and stats (admin only)
 * @tags Bridge
 * @security BearerAuth
 * @returns {object} 200 - Relayer reset successfully
 * @returns {object} 403 - Only administrators can reset
 * @returns {object} 500 - Reset failed
 */
router.post(
  '/bridge/relayer/reset',
  authenticate,
  asyncHandler(async (req, res) => {
    const relayer = getBridgeRelayer();

    const isAdmin = req.user?.role === 'admin' || req.user?.isAdmin;

    if (!isAdmin) {
      return res.status(403).json({
        success: false,
        error: 'Only administrators can reset the bridge relayer',
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

      logger.warn('Bridge relayer reset by admin', {
        correlationId: req.correlationId,
        userId: req.user?._id,
      });

      res.json({
        success: true,
        data: relayer.getStatus(),
      });
    } catch (error) {
      logger.error('Failed to reset bridge relayer', {
        correlationId: req.correlationId,
        error: error.message,
        userId: req.user?._id,
      });

      res.status(500).json({
        success: false,
        error: 'Failed to reset bridge relayer',
        details: error.message,
      });
    }
  }),
);

module.exports = router;
