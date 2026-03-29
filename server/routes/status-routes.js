const express = require('express');
const mongoose = require('mongoose');
const { asyncHandler } = require('../middleware/error-handler');
const { authenticate } = require('../middleware/auth');
const { sampler } = require('../services/resource-sampler');
const { version } = require('../package.json');

const router = express.Router();

/**
 * @title Status Routes
 * @author SoroMint Team
 * @notice Handles system health checks and network metadata reporting
 * @dev Provides real-time status of server, database, and Stellar network
 */

/**
 * @route GET /api/health
 * @description System health check and network metadata
 * @access Public
 *
 * @returns {Object} 200 - Health status object
 * @returns {Object} 503 - Service unavailable (if database is down)
 */
router.get('/health', asyncHandler(async (req, res) => {
  const uptime = process.uptime();
  
  // Check MongoDB connection status
  // 0: disconnected, 1: connected, 2: connecting, 3: disconnecting
  const dbStatus = mongoose.connection.readyState === 1 ? 'up' : 'down';
  
  const healthData = {
    status: dbStatus === 'up' ? 'healthy' : 'unhealthy',
    timestamp: new Date().toISOString(),
    version: version,
    uptime: `${Math.floor(uptime / 3600)}h ${Math.floor((uptime % 3600) / 60)}m ${Math.floor(uptime % 60)}s`,
    services: {
      database: {
        status: dbStatus,
        connection: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected'
      },
      stellar: {
        network: process.env.NETWORK_PASSPHRASE || 'not configured'
      }
    }
  };

  // Return 200 if healthy, 503 if database is down
  const statusCode = dbStatus === 'up' ? 200 : 503;
  
  res.status(statusCode).json(healthData);
}));

/**
 * @route GET /api/metrics
 * @description Returns the latest sampled CPU, memory, and disk usage.
 *              Includes active alerts for any metrics exceeding configured thresholds.
 * @access Private (JWT)
 * @returns {Object} 200 - Latest resource sample with alert state.
 * @returns {Object} 503 - Sampler not yet initialised.
 */
router.get('/metrics', authenticate, asyncHandler(async (req, res) => {
  const sample = sampler.latest;
  if (!sample) {
    return res.status(503).json({ error: 'Metrics not yet available', code: 'METRICS_UNAVAILABLE' });
  }
  res.json(sample);
}));

module.exports = router;
