'use strict';

const express = require('express');
const { z } = require('zod');
const Webhook = require('../models/Webhook');
const WebhookDelivery = require('../models/WebhookDelivery');
const { authenticate } = require('../middleware/auth');
const { asyncHandler, AppError } = require('../middleware/error-handler');
const { SUPPORTED_WEBHOOK_EVENTS } = require('../services/webhook-service');

const router = express.Router();

const getZodIssues = (error) => error.issues || error.errors || [];

const webhookSchema = z.object({
  url: z.string().url('Invalid URL'),
  events: z
    .array(z.enum(SUPPORTED_WEBHOOK_EVENTS))
    .min(1)
    .default(['token.minted']),
  secret: z.string().min(16, 'Secret must be at least 16 characters'),
});

/**
 * @openapi
 * @route POST /api/webhooks
 * @name createWebhook
 * @description Register a new webhook endpoint to receive event notifications
 * @tags Webhooks
 * @security BearerAuth
 * @param {string} url - Webhook endpoint URL (must be valid URL)
 * @param {array} events - Array of event types to subscribe to (token.minted, token.transferred, token.burned)
 * @param {string} secret - Webhook secret for signature verification (min 16 characters)
 * @returns {object} 201 - Created webhook
 */
router.post('/webhooks', authenticate, asyncHandler(async (req, res) => {
  const parsed = webhookSchema.safeParse(req.body);
  if (!parsed.success) {
    const msg = parsed.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join(', ');
    throw new AppError(msg, 400, 'VALIDATION_ERROR');
  }

    const webhook = await Webhook.create({
      ownerPublicKey: req.user.publicKey,
      ...parsed.data,
    });

    res.status(201).json({ success: true, data: webhook });
  })
);

/**
 * @openapi
 * @route GET /api/webhooks
 * @name listWebhooks
 * @description List all webhooks registered by the authenticated user
 * @tags Webhooks
 * @security BearerAuth
 * @returns {array} 200 - Array of webhooks
 */
router.get('/webhooks', authenticate, asyncHandler(async (req, res) => {
  const webhooks = await Webhook.find({ ownerPublicKey: req.user.publicKey }).select('-secret');
  res.json({ success: true, data: webhooks });
}));

/**
 * @openapi
 * @route DELETE /api/webhooks/{id}
 * @name deleteWebhook
 * @description Delete a registered webhook
 * @tags Webhooks
 * @security BearerAuth
 * @param {string} id - Webhook ID to delete
 * @returns {object} 200 - Success confirmation
 * @returns {object} 404 - Webhook not found
 */
router.delete('/webhooks/:id', authenticate, asyncHandler(async (req, res) => {
  const webhook = await Webhook.findOneAndUpdate(
    {
      _id: req.params.id,
      ownerPublicKey: req.user.publicKey,
    },
    { isArchived: true, deletedAt: new Date() },
    { new: true }
  );

    if (!webhook) throw new AppError('Webhook not found', 404, 'NOT_FOUND');

    res.json({ success: true });
  })
);

/**
 * @openapi
 * @route GET /api/webhooks/{id}/deliveries
 * @name listWebhookDeliveries
 * @description List delivery attempts for a specific webhook
 * @tags Webhooks
 * @security BearerAuth
 * @param {string} id - Webhook ID
 * @returns {array} 200 - Array of webhook deliveries
 * @returns {object} 404 - Webhook not found
 */
router.get('/webhooks/:id/deliveries', authenticate, asyncHandler(async (req, res) => {
  const webhook = await Webhook.findOne({
    _id: req.params.id,
    ownerPublicKey: req.user.publicKey,
  });

  if (!webhook) throw new AppError('Webhook not found', 404, 'NOT_FOUND');

  const { status, limit = 50, skip = 0 } = req.query;
  const query = { webhookId: webhook._id };
  if (status) {
    query.status = status;
  }

  const deliveries = await WebhookDelivery.find(query)
    .sort({ createdAt: -1 })
    .skip(Number(skip))
    .limit(Number(limit));

  res.json({ success: true, data: deliveries });
}));

/**
 * @openapi
 * @route POST /api/webhooks/deliveries/{deliveryId}/retry
 * @name retryWebhookDelivery
 * @description Manually retry a DLQ delivery
 * @tags Webhooks
 * @security BearerAuth
 * @param {string} deliveryId - Delivery ID
 * @returns {object} 200 - Success confirmation
 * @returns {object} 404 - Delivery not found or not in DLQ
 */
router.post('/webhooks/deliveries/:deliveryId/retry', authenticate, asyncHandler(async (req, res) => {
  const delivery = await WebhookDelivery.findById(req.params.deliveryId).populate('webhookId');
  if (!delivery) throw new AppError('WebhookDelivery not found', 404, 'NOT_FOUND');

  if (delivery.webhookId.ownerPublicKey !== req.user.publicKey) {
    throw new AppError('Unauthorized access to WebhookDelivery', 403, 'FORBIDDEN');
  }

  if (delivery.status !== 'DLQ' && delivery.status !== 'FAILED') {
    throw new AppError('Only FAILED or DLQ deliveries can be manually retried', 400, 'BAD_REQUEST');
  }

  const { webhookQueue } = require('../services/webhook-queue');

  // Reset status to PENDING and attempts to 0 for a fresh retry schedule
  delivery.status = 'PENDING';
  delivery.attempts = 0;
  await delivery.save();

  await webhookQueue.add('webhookDelivery', {
    deliveryId: String(delivery._id),
  });

  res.json({ success: true, message: 'Delivery queued for retry' });
}));

module.exports = router;
