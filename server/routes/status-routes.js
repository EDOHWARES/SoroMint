const express = require('express');
const mongoose = require('mongoose');
const { asyncHandler } = require('../middleware/error-handler');
const { authenticate } = require('../middleware/auth');
const { sampler } = require('../services/resource-sampler');
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
