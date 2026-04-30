'use strict';

const express = require('express');
const { z } = require('zod');
const StreamingService = require('../services/streaming-service');
const PlatformFeeService = require('../services/platform-fee-service');
const Stream = require('../models/Stream');
const { body, param, validationResult } = require('express-validator');
const { getCacheService } = require('../services/cache-service');
const Stream = require('../models/Stream');
const { body, param, query, validationResult } = require('express-validator');
const { authenticate } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/error-handler');
const { logger } = require('../utils/logger');
const { exportRateLimiter } = require('../middleware/rate-limiter');

const { Transform } = require('stream');

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
    body('cancellationDelay').optional().isInt({ min: 0 }),
    body('irrevocable').optional().isBoolean(),
    validate,
  ],
  async (req, res, next) => {
    try {
      const { sender, recipient, tokenAddress, totalAmount, startLedger, stopLedger } = req.body;

      const service = new StreamingService(
        process.env.SOROBAN_RPC_URL,
        process.env.NETWORK_PASSPHRASE
      );
      const feeService = new PlatformFeeService();

      // Calculate platform fee
      const feeAmount = await feeService.calculateFee(totalAmount, tokenAddress);
      const feePercentage = await feeService.getFeeConfig(tokenAddress);

      const normalizedTokenAddress = normalizeTokenAddress(tokenAddress);
      await requireWhitelistedToken(normalizedTokenAddress);

      const result = await service.createStream(
        process.env.STREAMING_CONTRACT_ID,
        req.sourceKeypair,
        sender,
        recipient,
        normalizedTokenAddress,
        totalAmount,
        startLedger,
        stopLedger,
        cancellationDelay,
        irrevocable
      );

      if (result.status === 'SUCCESS') {
        // Save stream to database with fee information
        const stream = new Stream({
          streamId: result.streamId || result.hash,
          contractId: process.env.STREAMING_CONTRACT_ID,
          sender,
          recipient,
          tokenAddress,
          totalAmount,
          ratePerLedger: calculateRatePerLedger(totalAmount, startLedger, stopLedger),
          startLedger,
          stopLedger,
          createdTxHash: result.hash,
          platformFeeAmount: feeAmount,
          platformFeePercentage: feePercentage,
        });

        await stream.save();

        // Create platform fee record
        await feeService.createPlatformFeeRecord({
          streamId: stream.streamId,
          totalAmount,
          tokenAddress,
        }, result.hash);

        await feeService.updateStreamWithFeeInfo(stream.streamId, feeAmount, feePercentage);
      }

      res.status(201).json({ 
        success: true, 
        streamId: result.streamId, 
        txHash: result.hash,
        platformFee: {
          amount: feeAmount,
          percentage: feePercentage,
        }
      });
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

      notifyStreamWebhooks('stream.withdrawn', {
        streamId: Number(streamId),
        amount,
        txHash: result.hash,
      });
      // Invalidate balance cache on withdrawal
      const cacheService = getCacheService();
      await cacheService.delete(`stream:balance:${streamId}`);

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

      notifyStreamWebhooks('stream.canceled', {
        streamId: Number(streamId),
        txHash: result.hash,
      });
      // Invalidate balance cache on cancellation
      const cacheService = getCacheService();
      await cacheService.delete(`stream:balance:${streamId}`);

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

      const stream = await service.getStream(
        process.env.STREAMING_CONTRACT_ID,
        streamId
      );

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

      const cacheService = getCacheService();
      const cacheKey = `stream:balance:${streamId}`;

      const balance = await cacheService.getOrSet(
        cacheKey,
        async () => {
          return await service.getStreamBalance(
            process.env.STREAMING_CONTRACT_ID,
            streamId
          );
        },
        { ttl: 5 }
      const balance = await service.getStreamBalance(
        process.env.STREAMING_CONTRACT_ID,
        streamId
      );

      res.json({ success: true, balance });
    } catch (error) {
      next(error);
    }
  }
);

module.exports = router;
