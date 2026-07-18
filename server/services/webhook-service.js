const crypto = require('crypto');
const https = require('https');
const http = require('http');
const { URL } = require('url');
const Webhook = require('../models/Webhook');
const { logger } = require('../utils/logger');

const MAX_RETRIES = 3;
const RETRY_DELAYS_MS = [1000, 3000, 9000];
const TOKEN_WEBHOOK_EVENTS = Object.freeze([
  'token.minted',
  'token.transferred',
  'token.burned',
]);
const STREAM_WEBHOOK_EVENTS = Object.freeze([
  'stream.created',
  'stream.withdrawn',
  'stream.canceled',
]);
const SUPPORTED_WEBHOOK_EVENTS = Object.freeze([
  ...TOKEN_WEBHOOK_EVENTS,
  ...STREAM_WEBHOOK_EVENTS,
]);

const sign = (secret, payload) =>
  'sha256=' + crypto.createHmac('sha256', secret).update(payload).digest('hex');

const deliver = (url, payload, signature, headers = {}) =>
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
          ...headers,
        },
        timeout: 5000,
      },
      (res) => {
        res.statusCode >= 200 && res.statusCode < 300
          ? resolve(res.statusCode)
          : reject(new Error(`HTTP ${res.statusCode}`));
        res.resume();
      }
    );

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('timeout'));
    });
    req.write(body);
    req.end();
  });

const dispatch = async (event, data) => {
  const webhooks = await Webhook.find({ events: event, active: true }).lean();
  if (webhooks.length === 0) {
    return [];
  }

  // Import the queue lazily to avoid circular dependencies if needed, or require at top.
  // Since webhook-service exports deliver and sign used by webhook-queue,
  // we require the queue here to avoid circular dependency issues at load time.
  const { webhookQueue } = require('./webhook-queue');
  const WebhookDelivery = require('../models/WebhookDelivery');

  const results = await Promise.allSettled(
    webhooks.map(async (wh) => {
      // Create pending delivery record
      const delivery = await WebhookDelivery.create({
        webhookId: wh._id,
        event,
        data,
        status: 'PENDING',
        attempts: 0,
      });

      // Enqueue job to BullMQ
      const job = await webhookQueue.add('webhookDelivery', {
        deliveryId: String(delivery._id),
      });

      return { deliveryId: delivery._id, jobId: job.id };
    })
  );

  return results;
};

module.exports = {
  dispatch,
  sign,
  deliver,
  TOKEN_WEBHOOK_EVENTS,
  STREAM_WEBHOOK_EVENTS,
  SUPPORTED_WEBHOOK_EVENTS,
};
