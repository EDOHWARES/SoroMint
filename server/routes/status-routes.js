'use strict';

const express = require('express');
const mongoose = require('mongoose');
const { asyncHandler } = require('../middleware/error-handler');
const { authenticate } = require('../middleware/auth');
const { sampler } = require('../services/resource-sampler');
const { version } = require('../package.json');

const router = express.Router();

/**
 * @openapi
 * @route GET /api/health
 * @name getHealth
 * @description System health check and network metadata
 * @tags System
 * @returns {object} 200 - Health status object
 * @returns {object} 503 - Service unavailable (if database is down)
 */
router.get('/health', asyncHandler(async (req, res) => {
  const uptime = process.uptime();

  const dbStatus = mongoose.connection.readyState === 1 ? 'up' : 'down';

  const healthData = {
    status: dbStatus === 'up' ? 'healthy' : 'unhealthy',
    timestamp: new Date().toISOString(),
    version: version,
    uptime: `${Math.floor(uptime / 3600)}h ${Math.floor((uptime % 3600) / 60)}m ${Math.floor(uptime % 60)}s`,
    services: {
      database: {
        status: dbStatus,
        connection: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
      },
      stellar: {
        network: process.env.NETWORK_PASSPHRASE || 'not configured',
      },
    },
  };

  const statusCode = dbStatus === 'up' ? 200 : 503;

  res.status(statusCode).json(healthData);
}));

/**
 * @openapi
 * @route GET /api/metrics
 * @name getMetrics
 * @description Returns the latest sampled CPU, memory, and disk usage with active alerts
 * @tags System
 * @security BearerAuth
 * @returns {object} 200 - Latest resource sample with alert state
 * @returns {object} 503 - Sampler not yet initialized
 */
router.get('/metrics', authenticate, asyncHandler(async (req, res) => {
  const sample = sampler.latest;
  if (!sample) {
    return res.status(503).json({ error: 'Metrics not yet available', code: 'METRICS_UNAVAILABLE' });
  }
  res.json(sample);
}));

module.exports = router;
