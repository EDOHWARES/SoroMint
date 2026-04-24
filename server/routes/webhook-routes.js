const express = require('express');
const crypto = require('crypto');
const { z } = require('zod');
const Webhook = require('../models/Webhook');
const { authenticate } = require('../middleware/auth');
const { asyncHandler, AppError } = require('../middleware/error-handler');

const router = express.Router();

const webhookSchema = z.object({
  url: z.string().url('Invalid URL'),
  events: z.array(z.enum(['token.minted', 'token.transferred', 'token.burned'])).min(1).default(['token.minted']),
  secret: z.string().min(16, 'Secret must be at least 16 characters'),
});

// POST /api/webhooks — register
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
}));

// GET /api/webhooks — list
router.get('/webhooks', authenticate, asyncHandler(async (req, res) => {
  const webhooks = await Webhook.find({ ownerPublicKey: req.user.publicKey }).select('-secret');
  res.json({ success: true, data: webhooks });
}));

// DELETE /api/webhooks/:id — remove
router.delete('/webhooks/:id', authenticate, asyncHandler(async (req, res) => {
  const webhook = await Webhook.findOneAndDelete({
    _id: req.params.id,
    ownerPublicKey: req.user.publicKey,
  });

  if (!webhook) throw new AppError('Webhook not found', 404, 'NOT_FOUND');

  res.json({ success: true });
}));

module.exports = router;
