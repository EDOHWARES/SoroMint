const { Queue, Worker } = require('bullmq');
const { logger } = require('../utils/logger');
const WebhookDelivery = require('../models/WebhookDelivery');
const Webhook = require('../models/Webhook');
const { deliver, sign } = require('./webhook-service');

// Initialize Redis connection for BullMQ
const { REDIS_URL } = require('../config/env-config');
const redisConnection = {
  url: REDIS_URL || 'redis://127.0.0.1:6379',
};

// Create the webhook queue
const webhookQueue = new Queue('webhookQueue', {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: 5,
    backoff: {
      type: 'exponential',
      delay: 300000, // 5 minutes, leading to ~5m, 10m, 20m, 40m, 80m delays
    },
    removeOnComplete: true,
    removeOnFail: false,
  },
});

const processWebhookDelivery = async (job) => {
  const { deliveryId } = job.data;
  const delivery = await WebhookDelivery.findById(deliveryId).populate('webhookId');

  if (!delivery || !delivery.webhookId) {
    throw new Error(`WebhookDelivery not found or missing webhook reference: ${deliveryId}`);
  }

  const webhook = delivery.webhookId;
  const { event, data } = delivery;

  const payload = JSON.stringify({
    event,
    data,
    webhookId: String(webhook._id),
    deliveredAt: new Date().toISOString(),
  });
  
  const signature = sign(webhook.secret, payload);

  try {
    delivery.attempts += 1;
    await deliver(webhook.url, payload, signature, {
      'X-SoroMint-Event': event,
      'X-SoroMint-Webhook-Id': String(webhook._id),
    });

    // Delivery successful
    delivery.status = 'SUCCESS';
    await delivery.save();
    logger.info('Webhook delivered via BullMQ', {
      deliveryId: delivery._id,
      webhookId: webhook._id,
      event,
      attempt: job.attemptsMade + 1,
    });

  } catch (error) {
    // Record failure details
    delivery.errorLogs.push(error.message || 'Unknown error during delivery');
    
    // Update status to FAILED temporarily, DLQ handled on max attempts exhaustion
    delivery.status = 'FAILED';
    await delivery.save();

    logger.warn('Webhook delivery failed via BullMQ', {
      deliveryId: delivery._id,
      webhookId: webhook._id,
      event,
      attempt: job.attemptsMade + 1,
      error: error.message,
    });

    // Throw error to trigger BullMQ retry logic
    throw error;
  }
};

// Worker to process webhook deliveries
const worker = new Worker('webhookQueue', processWebhookDelivery, { connection: redisConnection });

// Event listeners for Worker
worker.on('failed', async (job, err) => {
  // If the job has exhausted all retries, move to DLQ
  if (job.attemptsMade >= job.opts.attempts) {
    try {
      const { deliveryId } = job.data;
      await WebhookDelivery.findByIdAndUpdate(deliveryId, { status: 'DLQ' });
      logger.error('Webhook delivery exhausted retries, moved to DLQ', {
        deliveryId,
        error: err.message,
      });
    } catch (dbErr) {
      logger.error('Failed to update WebhookDelivery to DLQ', { error: dbErr.message });
    }
  }
});

worker.on('error', err => {
  logger.error('Webhook worker error', { error: err.message });
});

module.exports = {
  webhookQueue,
  worker,
  processWebhookDelivery,
};
