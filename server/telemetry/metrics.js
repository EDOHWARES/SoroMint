const crypto = require('crypto');
const express = require('express');
const mongoose = require('mongoose');
const client = require('prom-client');

const registry = new client.Registry();
client.collectDefaultMetrics({ register: registry, prefix: 'soromint_' });

const httpRequestsTotal = new client.Counter({
  name: 'soromint_http_requests_total',
  help: 'Total HTTP requests handled by the API',
  labelNames: ['method', 'route', 'status_code'],
  registers: [registry],
});
const httpRequestDuration = new client.Histogram({
  name: 'soromint_http_request_duration_seconds',
  help: 'HTTP request duration in seconds',
  labelNames: ['method', 'route', 'status_code'],
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
  registers: [registry],
});
const transactionDuration = new client.Histogram({
  name: 'soromint_transaction_duration_seconds',
  help: 'Blockchain transaction processing latency in seconds',
  labelNames: ['operation', 'status'],
  registers: [registry],
});
const rpcFailures = new client.Counter({
  name: 'soromint_rpc_failures_total',
  help: 'Failed Stellar or Soroban RPC calls',
  labelNames: ['endpoint', 'method', 'reason'],
  registers: [registry],
});
const activeWebSockets = new client.Gauge({
  name: 'soromint_websocket_connections_active',
  help: 'Currently active Socket.IO connections',
  registers: [registry],
});
const databasePoolConnections = new client.Gauge({
  name: 'soromint_database_pool_connections',
  help: 'MongoDB driver pool connections by state',
  labelNames: ['state'],
  registers: [registry],
  collect() {
    const servers = mongoose.connection?.client?.topology?.s?.servers;
    const pools = servers
      ? [...servers.values()].map((server) => server.pool).filter(Boolean)
      : [];
    const total = pools.reduce(
      (sum, pool) => sum + (pool.totalConnectionCount || 0),
      0
    );
    const available = pools.reduce(
      (sum, pool) => sum + (pool.availableConnectionCount || 0),
      0
    );
    this.set({ state: 'total' }, total);
    this.set({ state: 'available' }, available);
    this.set({ state: 'in_use' }, Math.max(total - available, 0));
  },
});

const safeEqual = (actual, expected) => {
  const actualBuffer = Buffer.from(actual || '');
  const expectedBuffer = Buffer.from(expected || '');
  return (
    actualBuffer.length === expectedBuffer.length &&
    crypto.timingSafeEqual(actualBuffer, expectedBuffer)
  );
};

const requireMetricsAuth = (req, res, next) => {
  const username = process.env.METRICS_USERNAME;
  const password = process.env.METRICS_PASSWORD;
  if (!username || !password)
    return res.status(503).send('Metrics credentials are not configured');

  const [scheme, encoded] = (req.get('authorization') || '').split(' ');
  let suppliedUser = '';
  let suppliedPassword = '';
  if (scheme === 'Basic' && encoded) {
    [suppliedUser, suppliedPassword] = Buffer.from(encoded, 'base64')
      .toString('utf8')
      .split(':', 2);
  }
  if (
    !safeEqual(suppliedUser, username) ||
    !safeEqual(suppliedPassword, password)
  ) {
    res.set('WWW-Authenticate', 'Basic realm="SoroMint metrics"');
    return res.status(401).send('Authentication required');
  }
  return next();
};

const metricsMiddleware = (req, res, next) => {
  const startedAt = process.hrtime.bigint();
  res.on('finish', () => {
    const route = req.route?.path || req.baseUrl || req.path || 'unknown';
    const labels = {
      method: req.method,
      route,
      status_code: String(res.statusCode),
    };
    httpRequestsTotal.inc(labels);
    httpRequestDuration.observe(
      labels,
      Number(process.hrtime.bigint() - startedAt) / 1e9
    );
  });
  next();
};

const metricsRouter = express.Router();
metricsRouter.get('/', requireMetricsAuth, async (req, res, next) => {
  try {
    res.set('Content-Type', registry.contentType);
    res.end(await registry.metrics());
  } catch (error) {
    next(error);
  }
});

const observeTransaction = (operation, status, seconds) =>
  transactionDuration.observe({ operation, status }, seconds);
const recordRpcFailure = (endpoint, method, reason = 'unknown') =>
  rpcFailures.inc({ endpoint, method, reason });
const websocketConnected = () => activeWebSockets.inc();
const websocketDisconnected = () => activeWebSockets.dec();

module.exports = {
  registry,
  httpRequestsTotal,
  httpRequestDuration,
  transactionDuration,
  rpcFailures,
  activeWebSockets,
  databasePoolConnections,
  metricsRouter,
  metricsMiddleware,
  requireMetricsAuth,
  observeTransaction,
  recordRpcFailure,
  websocketConnected,
  websocketDisconnected,
};
