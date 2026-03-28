const crypto = require('crypto');
const https = require('https');
const http = require('http');
const { URL } = require('url');
const Webhook = require('../models/Webhook');
const { logger } = require('../utils/logger');

const MAX_RETRIES = 3;
const RETRY_DELAYS_MS = [1000, 3000, 9000];

const sign = (secret, payload) =>
  'sha256=' + crypto.createHmac('sha256', secret).update(payload).digest('hex');

const deliver = (url, payload, signature) =>
  new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const lib = parsed.protocol === 'https:' ? https : http;
    const body = Buffer.from(payload);

    const req = lib.request(
      {
        hostname: parsed.hostname,
        port: parsed.port,
        path: parsed.pathname + parsed.search,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': body.length,
          'X-SoroMint-Signature': signature,
        },
        timeout: 5000,
      },
      (res) => {
        res.statusCode >= 200 && res.statusCode < 300 ? resolve(res.statusCode) : reject(new Error(`HTTP ${res.statusCode}`));
        res.resume();
      }
    );

    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    req.write(body);
    req.end();
  });

const deliverWithRetry = async (webhook, event, data) => {
  const payload = JSON.stringify({ event, data, webhookId: webhook._id });
  const signature = sign(webhook.secret, payload);

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      await deliver(webhook.url, payload, signature);
      logger.info('Webhook delivered', { webhookId: webhook._id, event, attempt });
      return;
    } catch (err) {
      logger.warn('Webhook delivery failed', { webhookId: webhook._id, event, attempt, error: err.message });
      if (attempt < MAX_RETRIES) {
        await new Promise((r) => setTimeout(r, RETRY_DELAYS_MS[attempt]));
      }
    }
  }

  logger.error('Webhook delivery exhausted retries', { webhookId: webhook._id, event });
};

const dispatch = async (event, data) => {
  const webhooks = await Webhook.find({ events: event, active: true });
  webhooks.forEach((wh) => deliverWithRetry(wh, event, data));
};

module.exports = { dispatch, sign };
