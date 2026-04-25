const express = require('express');
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
    validate,
  ],
  async (req, res, next) => {
    try {
      const { sender, recipient, tokenAddress, totalAmount, startLedger, stopLedger } = req.body;
      
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

      res.status(201).json({ success: true, streamId: result.streamId, txHash: result.hash });
    } catch (error) {
      next(error);
    }
  }
);

router.post(
  '/schedule',
  [
    body('sender').isString().notEmpty(),
    body('recipient').isString().notEmpty(),
    body('tokenAddress').isString().notEmpty(),
    body('totalAmount').isString().notEmpty(),
    body('startLedger').isInt({ min: 0 }),
    body('stopLedger').isInt({ min: 0 }),
    body('scheduledStartLedger').isInt({ min: 0 }),
    validate,
  ],
  async (req, res, next) => {
    try {
      const scheduledStreamService = require('../services/scheduled-stream-service');
      const stream = await scheduledStreamService.scheduleStream(req.body);

      res.status(201).json({ 
        success: true, 
        message: 'Stream scheduled successfully',
        id: stream._id,
        scheduledStartLedger: stream.scheduledStartLedger
      });
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
  '/user/:address',
  [param('address').isString().notEmpty(), validate],
  async (req, res, next) => {
    try {
      const { address } = req.params;
      const Stream = require('../models/Stream');
      
      const streams = await Stream.find({
        $or: [{ sender: address }, { recipient: address }]
      }).sort({ createdAt: -1 });

      res.json({ success: true, streams });
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

module.exports = router;
