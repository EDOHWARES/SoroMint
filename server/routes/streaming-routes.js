const express = require('express');
const Stream = require('../models/Stream');
const StreamingService = require('../services/streaming-service');
const { body, param, validationResult } = require('express-validator');

const router = express.Router();

const validate = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }
  next();
};

router.post(
  '/streams',
  [
    body('sender').isString().notEmpty(),
    body('recipient').isString().notEmpty(),
    body('tokenAddress').isString().notEmpty(),
    body('totalAmount').isString().notEmpty(),
    body('startLedger').isInt({ min: 0 }),
    body('stopLedger').isInt({ min: 0 }),
    body('metadata')
      .optional()
      .isObject()
      .withMessage('metadata must be a plain object')
      .custom((value) => {
        if (!value) return true;
        const keys = Object.keys(value);
        if (keys.length > 50) throw new Error('metadata cannot have more than 50 keys');
        for (const key of keys) {
          if (!/^[a-zA-Z0-9_-]{1,64}$/.test(key)) {
            throw new Error(`Invalid metadata key: "${key}". Keys must be alphanumeric (a-z, 0-9, _, -) and max 64 chars`);
          }
          const val = value[key];
          if (val !== null && typeof val === 'object') {
            throw new Error(`Metadata values must be primitives (string, number, boolean, null), not objects or arrays`);
          }
          if (typeof val === 'string' && val.length > 512) {
            throw new Error(`Metadata string values must not exceed 512 characters`);
          }
        }
        return true;
      }),
    validate,
  ],
  async (req, res, next) => {
    try {
      const { sender, recipient, tokenAddress, totalAmount, startLedger, stopLedger, metadata } = req.body;
      
      const service = new StreamingService(
        process.env.SOROBAN_RPC_URL,
        process.env.NETWORK_PASSPHRASE
      );

      const result = await service.createStream(
        process.env.STREAMING_CONTRACT_ID,
        req.sourceKeypair,
        sender,
        recipient,
        tokenAddress,
        totalAmount,
        startLedger,
        stopLedger
      );

     // Persist metadata to MongoDB if provided
      if (metadata && Object.keys(metadata).length > 0) {
        await Stream.findOneAndUpdate(
          { streamId: result.streamId },
          { metadata: new Map(Object.entries(metadata)) },
          { upsert: true, new: true }
        );
      }
      res.status(201).json({ success: true, streamId: result.streamId, txHash: result.hash, metadata: metadata ?? {} });
    } catch (error) {
      next(error);
    }
  }
);

router.post(
  '/streams/:streamId/withdraw',
  [
    param('streamId').isInt({ min: 0 }),
    body('amount').isString().notEmpty(),
    validate,
  ],
  async (req, res, next) => {
    try {
      const { streamId } = req.params;
      const { amount } = req.body;

      const service = new StreamingService(
        process.env.SOROBAN_RPC_URL,
        process.env.NETWORK_PASSPHRASE
      );

      const result = await service.withdraw(
        process.env.STREAMING_CONTRACT_ID,
        req.sourceKeypair,
        streamId,
        amount
      );

      res.json({ success: true, txHash: result.hash });
    } catch (error) {
      next(error);
    }
  }
);

router.delete(
  '/streams/:streamId',
  [param('streamId').isInt({ min: 0 }), validate],
  async (req, res, next) => {
    try {
      const { streamId } = req.params;

      const service = new StreamingService(
        process.env.SOROBAN_RPC_URL,
        process.env.NETWORK_PASSPHRASE
      );

      const result = await service.cancelStream(
        process.env.STREAMING_CONTRACT_ID,
        req.sourceKeypair,
        streamId
      );

      res.json({ success: true, txHash: result.hash });
    } catch (error) {
      next(error);
    }
  }
);

router.get(
  '/streams/:streamId',
  [param('streamId').isInt({ min: 0 }), validate],
  async (req, res, next) => {
    try {
      const { streamId } = req.params;

      const service = new StreamingService(
        process.env.SOROBAN_RPC_URL,
        process.env.NETWORK_PASSPHRASE
      );

      const stream = await service.getStream(process.env.STREAMING_CONTRACT_ID, streamId);

      if (!stream) {
        return res.status(404).json({ error: 'Stream not found' });
      }

      res.json({ success: true, stream });
    } catch (error) {
      next(error);
    }
  }
);

router.get(
  '/streams/:streamId/balance',
  [param('streamId').isInt({ min: 0 }), validate],
  async (req, res, next) => {
    try {
      const { streamId } = req.params;

      const service = new StreamingService(
        process.env.SOROBAN_RPC_URL,
        process.env.NETWORK_PASSPHRASE
      );

      const balance = await service.getStreamBalance(process.env.STREAMING_CONTRACT_ID, streamId);

      res.json({ success: true, balance });
    } catch (error) {
      next(error);
    }
  }
);
// GET /streams — filter by metadata key/value
router.get(
  '/streams',
  async (req, res, next) => {
    try {
      const { metadataKey, metadataValue, sender, recipient, status } = req.query;

      const filter = {};

      if (sender) filter.sender = sender;
      if (recipient) filter.recipient = recipient;
      if (status) filter.status = status;

      if (metadataKey) {
        // Sanitize key
        if (!/^[a-zA-Z0-9_-]{1,64}$/.test(metadataKey)) {
          return res.status(400).json({ error: 'Invalid metadataKey format' });
        }
        if (metadataValue !== undefined) {
          filter[`metadata.${metadataKey}`] = metadataValue;
        } else {
          // Filter by key existence
          filter[`metadata.${metadataKey}`] = { $exists: true };
        }
      }

      const streams = await Stream.find(filter).lean();
      res.json({ success: true, streams });
    } catch (error) {
      next(error);
    }
  }
);

// PATCH /streams/:streamId/metadata — update metadata on existing stream
router.patch(
  '/streams/:streamId/metadata',
  [
    param('streamId').isString().notEmpty(),
    body('metadata')
      .isObject()
      .withMessage('metadata must be a plain object')
      .custom((value) => {
        const keys = Object.keys(value);
        if (keys.length > 50) throw new Error('metadata cannot have more than 50 keys');
        for (const key of keys) {
          if (!/^[a-zA-Z0-9_-]{1,64}$/.test(key)) {
            throw new Error(`Invalid metadata key: "${key}"`);
          }
          const val = value[key];
          if (val !== null && typeof val === 'object') {
            throw new Error('Metadata values must be primitives');
          }
          if (typeof val === 'string' && val.length > 512) {
            throw new Error('Metadata string values must not exceed 512 characters');
          }
        }
        return true;
      }),
    validate,
  ],
  async (req, res, next) => {
    try {
      const { streamId } = req.params;
      const { metadata } = req.body;

      const stream = await Stream.findOneAndUpdate(
        { streamId },
        { metadata: new Map(Object.entries(metadata)) },
        { new: true }
      );

      if (!stream) {
        return res.status(404).json({ error: 'Stream not found' });
      }

      res.json({ success: true, metadata: Object.fromEntries(stream.metadata) });
    } catch (error) {
      next(error);
    }
  }
);
module.exports = router;
