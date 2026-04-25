const express = require('express');
const StreamingService = require('../services/streaming-service');
const { asyncHandler } = require('../middleware/error-handler');
const { body, param, validationResult } = require('express-validator');

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
      const {
        sender,
        recipient,
        tokenAddress,
        totalAmount,
        startLedger,
        stopLedger,
      } = req.body;
      const service = getService();
      const result = await service.createStream(
        getContractId(),
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
      const { streamId } = req.params;
      const { amount } = req.body;
      const service = getService();
      const result = await service.withdraw(
        getContractId(),
        req.sourceKeypair,
        streamId,
        amount
      );

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

      res.json({ success: true, balance });
    })
  );

  return router;
};

module.exports = createStreamingRouter();
module.exports.createStreamingRouter = createStreamingRouter;
