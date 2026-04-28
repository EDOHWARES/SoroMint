const express = require('express');
const mongoose = require('mongoose');
const { asyncHandler } = require('../middleware/error-handler');
const { authenticate } = require('../middleware/auth');
const { sampler } = require('../services/resource-sampler');
const { getRpcServer } = require('../services/stellar-service');
const { getCacheService } = require('../services/cache-service');
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
 * @description Simple liveness check for load balancers
 * @access Public
 */
router.get('/health', asyncHandler(async (req, res) => {
  const dbStatus = mongoose.connection.readyState === 1;
  const cacheStatus = getCacheService().isHealthy();
  
  const isHealthy = dbStatus && cacheStatus;
  
  res.status(isHealthy ? 200 : 503).json({
    status: isHealthy ? 'UP' : 'DOWN',
    timestamp: new Date().toISOString()
  });
}));

/**
 * @route GET /api/status
 * @description Detailed system status for monitoring tools
 * @access Public
 */
router.get('/status', asyncHandler(async (req, res) => {
  const uptime = process.uptime();
  const dbStatus = mongoose.connection.readyState === 1 ? 'up' : 'down';
  const cacheService = getCacheService();
  const cacheStatus = cacheService.isHealthy() ? 'up' : 'down';
  
  let rpcStatus = 'unknown';
  try {
    const rpcHealth = await getRpcServer().execute(s => s.getHealth());
    rpcStatus = rpcHealth.status === 'healthy' ? 'up' : 'down';
  } catch (error) {
    rpcStatus = 'down';
  }

  const metrics = sampler.latest || { 
    cpu: { usedPercent: 0, loadAvg: [0, 0, 0] }, 
    memory: { usedPercent: 0 }, 
    disk: { usedPercent: 0 } 
  };
  
  const statusData = {
    status: (dbStatus === 'up' && rpcStatus === 'up') ? 'healthy' : 'unhealthy',
    timestamp: new Date().toISOString(),
    version: version,
    uptime: `${Math.floor(uptime / 3600)}h ${Math.floor((uptime % 3600) / 60)}m ${Math.floor(uptime % 60)}s`,
    resources: {
      cpu: metrics.cpu.usedPercent,
      memory: metrics.memory.usedPercent,
      loadAvg: metrics.cpu.loadAvg
    },
    services: {
      database: {
        status: dbStatus,
        connection: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected'
      },
      cache: {
        status: cacheStatus
      },
      stellar: {
        rpcStatus: rpcStatus,
        network: process.env.NETWORK_PASSPHRASE || 'not configured'
      }
    }
  };

  const statusCode = statusData.status === 'healthy' ? 200 : 503;
  res.status(statusCode).json(statusData);
}));

/**
 * @route GET /api/metrics
 * @description Returns the latest sampled CPU, memory, and disk usage.
 *              Includes active alerts for any metrics exceeding configured thresholds.
 * @access Private (JWT)
 */
router.get(
  '/metrics',
  authenticate,
  asyncHandler(async (req, res) => {
    const sample = sampler.latest;
    if (!sample) {
      return res
        .status(503)
        .json({
          error: 'Metrics not yet available',
          code: 'METRICS_UNAVAILABLE',
        });
    }
    res.json(sample);
  })
);

module.exports = router;

