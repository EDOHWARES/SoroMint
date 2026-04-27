const express = require('express');
const StreamingService = require('../services/streaming-service');
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
 * @route GET /api/streaming/export
 * @description Export streaming history as CSV or JSON
 * @access Private
 * @query {string} format - Export format (csv or json, default: csv)
 * @query {string} startDate - Filter streams from this date
 * @query {string} endDate - Filter streams to this date
 */
router.get(
  '/export',
  authenticate,
  exportRateLimiter,
  [
    query('format').optional().isIn(['csv', 'json']),
    query('startDate')
      .optional()
      .isISO8601()
      .withMessage('Invalid startDate format'),
    query('endDate')
      .optional()
      .isISO8601()
      .withMessage('Invalid endDate format'),
    validate,
  ],
  asyncHandler(async (req, res) => {
    const { format = 'csv', startDate, endDate } = req.query;
    const publicKey = req.user.publicKey;

    logger.info('Exporting streaming history', {
      correlationId: req.correlationId,
      user: publicKey,
      format,
      startDate,
      endDate,
    });

    const dbQuery = {
      $or: [{ sender: publicKey }, { recipient: publicKey }],
    };

    if (startDate || endDate) {
      dbQuery.createdAt = {};
      if (startDate) dbQuery.createdAt.$gte = new Date(startDate);
      if (endDate) dbQuery.createdAt.$lte = new Date(endDate);
    }

    if (format === 'json') {
      const streams = await Stream.find(dbQuery).sort({ createdAt: -1 });
      res.setHeader('Content-Type', 'application/json');
      res.setHeader(
        'Content-Disposition',
        'attachment; filename=streaming_history.json'
      );
      return res.json({
        success: true,
        count: streams.length,
        data: streams,
      });
    }

    // Default to CSV with streaming
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader(
      'Content-Disposition',
      'attachment; filename=streaming_history.csv'
    );
    res.write(CSV_HEADERS);

    const cursor = Stream.find(dbQuery).sort({ createdAt: -1 }).cursor();

    const transformer = new Transform({
      objectMode: true,
      transform(doc, _enc, cb) {
        cb(null, streamToCSV(doc));
      },
    });

    transformer.on('error', (err) => {
      logger.error('Export stream error', { error: err.message });
      res.destroy(err);
    });

    cursor.pipe(transformer).pipe(res);
  })
);

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
      const {
        sender,
        recipient,
        tokenAddress,
        totalAmount,
        startLedger,
        stopLedger,
      } = req.body;

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

      res
        .status(201)
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

      // Invalidate balance cache on withdrawal
      const cacheService = getCacheService();
      await cacheService.delete(`stream:balance:${streamId}`);

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

      // Invalidate balance cache on cancellation
      const cacheService = getCacheService();
      await cacheService.delete(`stream:balance:${streamId}`);

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
