'use strict';

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

/**
 * @openapi
 * @route POST /api/streaming/streams
 * @name createStream
 * @description Create a new streaming payment stream
 * @tags Streaming
 * @security BearerAuth
 * @param {string} sender - Sender's Stellar public key
 * @param {string} recipient - Recipient's Stellar public key
 * @param {string} tokenAddress - Token contract address
 * @param {string} totalAmount - Total amount to stream
 * @param {integer} startLedger - Start ledger number
 * @param {integer} stopLedger - Stop ledger number
 * @returns {object} 201 - Created stream with streamId and txHash
 * @returns {object} 400 - Validation error
 */
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

/**
 * @openapi
 * @route POST /api/streaming/streams/{streamId}/withdraw
 * @name withdrawFromStream
 * @description Withdraw funds from an active streaming payment
 * @tags Streaming
 * @security BearerAuth
 * @param {integer} streamId - Stream ID to withdraw from
 * @param {string} amount - Amount to withdraw
 * @returns {object} 200 - Withdrawal confirmation with txHash
 * @returns {object} 400 - Validation error
 */
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

/**
 * @openapi
 * @route DELETE /api/streaming/streams/{streamId}
 * @name cancelStream
 * @description Cancel an active streaming payment and refund remaining funds
 * @tags Streaming
 * @security BearerAuth
 * @param {integer} streamId - Stream ID to cancel
 * @returns {object} 200 - Cancellation confirmation with txHash
 * @returns {object} 400 - Validation error
 */
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

/**
 * @openapi
 * @route GET /api/streaming/streams/{streamId}
 * @name getStream
 * @description Get details of a specific streaming payment
 * @tags Streaming
 * @security BearerAuth
 * @param {integer} streamId - Stream ID to retrieve
 * @returns {object} 200 - Stream details
 * @returns {object} 404 - Stream not found
 */
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

/**
 * @openapi
 * @route GET /api/streaming/streams/{streamId}/balance
 * @name getStreamBalance
 * @description Get the current withdrawable balance of a streaming payment
 * @tags Streaming
 * @security BearerAuth
 * @param {integer} streamId - Stream ID to check balance
 * @returns {object} 200 - Current withdrawable balance
 */
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
