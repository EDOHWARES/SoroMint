'use strict';

const express = require('express');
const mongoose = require('mongoose');
const { asyncHandler } = require('../middleware/error-handler');
const { authenticate } = require('../middleware/auth');
const { sampler } = require('../services/resource-sampler');
const { getRpcServer } = require('../services/stellar-service');
const { getCacheService } = require('../services/cache-service');
const { version } = require('../package.json');

const router = express.Router();
const DATABASE_CONNECTED_STATE = 1;
const STATIC_DATABASE_SERVICES = Object.freeze({
  up: Object.freeze({ status: 'up', connection: 'connected' }),
  down: Object.freeze({ status: 'down', connection: 'disconnected' }),
});
const NOT_CONFIGURED_NETWORK = 'not configured';

let cachedNetworkPassphrase = null;
let cachedStellarService = Object.freeze({ network: NOT_CONFIGURED_NETWORK });

const formatUptime = (uptimeSeconds) => {
  const totalSeconds = Math.max(0, Math.floor(uptimeSeconds));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  return `${hours}h ${minutes}m ${seconds}s`;
};

const getStellarService = () => {
  const network = process.env.NETWORK_PASSPHRASE || NOT_CONFIGURED_NETWORK;

  if (network !== cachedNetworkPassphrase) {
    cachedNetworkPassphrase = network;
    cachedStellarService = Object.freeze({ network });
  }

  return cachedStellarService;
};

/**
 * @openapi
 * @route GET /api/health
 * @name getHealth
 * @description System health check and network metadata
 * @tags System
 * @returns {object} 200 - Health status object
 * @returns {object} 503 - Service unavailable (if database is down)
 */
const healthHandler = (_req, res) => {
  const isDatabaseConnected =
    mongoose.connection.readyState === DATABASE_CONNECTED_STATE;
  const dbStatus = isDatabaseConnected ? 'up' : 'down';
  const healthData = {
    status: dbStatus === 'up' ? 'healthy' : 'unhealthy',
    timestamp: new Date().toISOString(),
    version,
    uptime: formatUptime(process.uptime()),
    services: {
      database: STATIC_DATABASE_SERVICES[dbStatus],
      stellar: getStellarService(),
    },
  };

  res.status(isDatabaseConnected ? 200 : 503).json(healthData);
};

router.get('/health', healthHandler);
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

  const healthData = {
    status: dbStatus === 'up' ? 'healthy' : 'unhealthy',
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
        connection: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
      },
      cache: {
        status: cacheStatus
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

