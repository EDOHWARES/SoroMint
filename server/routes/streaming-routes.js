'use strict';

const express = require('express');
const Stream = require('../models/Stream');
const StreamingService = require('../services/streaming-service');
const { body, param, query, validationResult } = require('express-validator');
const { authenticate } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/error-handler');
const { logger } = require('../utils/logger');
const { exportRateLimiter } = require('../middleware/rate-limiter');

const { Transform } = require('stream');

const getStreamingService =
  StreamingService.getStreamingService ||
  (() =>
    new StreamingService(
      process.env.SOROBAN_RPC_URL,
      process.env.NETWORK_PASSPHRASE,
      process.env.STREAMING_CONTRACT_ID
    ));

const validate = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }
  next();
};

const getStreamingContractId = () => process.env.STREAMING_CONTRACT_ID;

const createStreamingRouter = ({
  getService = getStreamingService,
  getContractId = getStreamingContractId,
} = {}) => {
  const router = express.Router();

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
    asyncHandler(async (req, res) => {
const escapeCSV = (val) => {
  if (val == null) return '""';
  const str = String(val).replace(/"/g, '""');
  return `"${str}"`;
};

const streamToCSV = (doc) =>
  [
    doc.streamId,
    doc.contractId,
    doc.sender,
    doc.recipient,
    doc.tokenAddress,
    doc.totalAmount,
    doc.ratePerLedger,
    doc.startLedger,
    doc.stopLedger,
    doc.withdrawn,
    doc.status,
    doc.createdAt?.toISOString(),
  ]
    .map(escapeCSV)
    .join(',') + '\n';

const CSV_HEADERS =
  'streamId,contractId,sender,recipient,tokenAddress,totalAmount,ratePerLedger,startLedger,stopLedger,withdrawn,status,createdAt\n';

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
    body('isPublic').optional().isBoolean(),
    validate,
  ],
  async (req, res, next) => {
    try {
      const {
        sender,
        recipient,
        tokenAddress,
        totalAmount,
        startLedger,
        stopLedger,
      } = req.body;
      const service = getService();

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
        getContractId(),
        req.sourceKeypair,
        sender,
        recipient,
        normalizedTokenAddress,
        totalAmount,
        startLedger,
        stopLedger,
        isPublic
      );

      res
        .status(201)
        .json({ success: true, streamId: result.streamId, txHash: result.hash });
    })
  );

  router.post(
    '/streams/:streamId/withdraw',
    [
      param('streamId').isInt({ min: 0 }),
      body('amount').isString().notEmpty(),
      validate,
    ],
    asyncHandler(async (req, res) => {
        .json({
          success: true,
          streamId: result.streamId,
          txHash: result.hash,
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
      const service = getService();
      const result = await service.withdraw(
        getContractId(),
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
    })
  );

  router.delete(
    '/streams/:streamId',
    [param('streamId').isInt({ min: 0 }), validate],
    asyncHandler(async (req, res) => {
      const { streamId } = req.params;
      const service = getService();
      const result = await service.cancelStream(
        getContractId(),
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
    })
  );

  router.get(
    '/streams/:streamId',
    [param('streamId').isInt({ min: 0 }), validate],
    asyncHandler(async (req, res) => {
      const { streamId } = req.params;
      const service = getService();
      const stream = await service.getStream(getContractId(), streamId);

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
    })
  );

  router.get(
    '/streams/:streamId/balance',
    [param('streamId').isInt({ min: 0 }), validate],
    asyncHandler(async (req, res) => {
      const { streamId } = req.params;
      const service = getService();
      const balance = await service.getStreamBalance(getContractId(), streamId);

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
    })
  );

  return router;
};

module.exports = createStreamingRouter();
module.exports.createStreamingRouter = createStreamingRouter;
