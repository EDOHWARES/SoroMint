const express = require('express');
const { z } = require('zod');
const StreamingService = require('../services/streaming-service');
const StreamingTokenWhitelist = require('../models/StreamingTokenWhitelist');
const { authenticate, authorize } = require('../middleware/auth');
const { asyncHandler, AppError } = require('../middleware/error-handler');
const { dispatch } = require('../services/webhook-service');
const { logger } = require('../utils/logger');
const { body, param, validationResult } = require('express-validator');

const router = express.Router();

const validate = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }
  next();
};

const getZodIssues = (error) => error.issues || error.errors || [];
const normalizeTokenAddress = (tokenAddress) => tokenAddress.trim();

const whitelistSchema = z.object({
  tokenAddress: z.string().min(1, 'tokenAddress is required'),
  tokenName: z.string().trim().optional().default(''),
  tokenSymbol: z.string().trim().optional().default(''),
  category: z.enum(['stablecoin', 'platform']).default('platform'),
  notes: z.string().trim().optional().default(''),
  active: z.coerce.boolean().optional().default(true),
});

const requireWhitelistedToken = async (tokenAddress) => {
  const normalizedTokenAddress = normalizeTokenAddress(tokenAddress);
  const whitelistEntry = await StreamingTokenWhitelist.findOne({
    tokenAddress: normalizedTokenAddress,
    active: true,
  });

  if (!whitelistEntry) {
    throw new AppError(
      'Token is not approved for streaming. Ask an admin to whitelist the token first.',
      403,
      'TOKEN_NOT_WHITELISTED'
    );
  }

  return whitelistEntry;
};

const notifyStreamWebhooks = (event, data) => {
  void dispatch(event, data).catch((error) => {
    logger.warn('Stream webhook dispatch failed', {
      event,
      error: error.message,
    });
  });
};

router.get(
  '/whitelist',
  authenticate,
  authorize('admin'),
  asyncHandler(async (_req, res) => {
    const entries = await StreamingTokenWhitelist.find({});

    res.json({ success: true, data: entries });
  })
);

router.post(
  '/whitelist',
  authenticate,
  authorize('admin'),
  asyncHandler(async (req, res) => {
    const parsed = whitelistSchema.safeParse(req.body);
    if (!parsed.success) {
      const message = getZodIssues(parsed.error)
        .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
        .join(', ');
      throw new AppError(message, 400, 'VALIDATION_ERROR');
    }

    const normalizedTokenAddress = normalizeTokenAddress(
      parsed.data.tokenAddress
    );

    const entry = await StreamingTokenWhitelist.findOneAndUpdate(
      { tokenAddress: normalizedTokenAddress },
      {
        $set: {
          tokenAddress: normalizedTokenAddress,
          tokenName: parsed.data.tokenName,
          tokenSymbol: parsed.data.tokenSymbol,
          category: parsed.data.category,
          notes: parsed.data.notes,
          active: parsed.data.active,
          updatedBy: req.user.publicKey,
          deactivatedBy: parsed.data.active ? '' : req.user.publicKey,
          deactivatedAt: parsed.data.active ? null : new Date(),
        },
        $setOnInsert: {
          createdBy: req.user.publicKey,
        },
      },
      {
        new: true,
        upsert: true,
        runValidators: true,
      }
    );

    res.status(201).json({ success: true, data: entry });
  })
);

router.patch(
  '/whitelist/:tokenAddress',
  authenticate,
  authorize('admin'),
  asyncHandler(async (req, res) => {
    const parsed = whitelistSchema.partial().safeParse(req.body);
    if (!parsed.success) {
      const message = getZodIssues(parsed.error)
        .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
        .join(', ');
      throw new AppError(message, 400, 'VALIDATION_ERROR');
    }

    const normalizedTokenAddress = normalizeTokenAddress(
      req.params.tokenAddress
    );
    const updates = parsed.data;

    if (
      updates.tokenAddress &&
      normalizeTokenAddress(updates.tokenAddress) !== normalizedTokenAddress
    ) {
      throw new AppError(
        'tokenAddress in the body must match the whitelist entry being updated.',
        400,
        'VALIDATION_ERROR'
      );
    }

    const entry = await StreamingTokenWhitelist.findOneAndUpdate(
      { tokenAddress: normalizedTokenAddress },
      {
        $set: {
          ...updates,
          ...(updates.tokenAddress
            ? { tokenAddress: normalizedTokenAddress }
            : {}),
          updatedBy: req.user.publicKey,
          ...(updates.active === false
            ? {
                deactivatedBy: req.user.publicKey,
                deactivatedAt: new Date(),
              }
            : updates.active === true
              ? {
                  deactivatedBy: '',
                  deactivatedAt: null,
                }
              : {}),
          ...(updates.active === true
            ? {
                active: true,
              }
            : {}),
        },
      },
      {
        new: true,
        runValidators: true,
      }
    );

    if (!entry) {
      throw new AppError('Whitelist token not found', 404, 'NOT_FOUND');
    }

    res.json({ success: true, data: entry });
  })
);

router.delete(
  '/whitelist/:tokenAddress',
  authenticate,
  authorize('admin'),
  asyncHandler(async (req, res) => {
    const normalizedTokenAddress = normalizeTokenAddress(
      req.params.tokenAddress
    );

    const entry = await StreamingTokenWhitelist.findOneAndUpdate(
      { tokenAddress: normalizedTokenAddress },
      {
        $set: {
          active: false,
          updatedBy: req.user.publicKey,
          deactivatedBy: req.user.publicKey,
          deactivatedAt: new Date(),
        },
      },
      {
        new: true,
        runValidators: true,
      }
    );

    if (!entry) {
      throw new AppError('Whitelist token not found', 404, 'NOT_FOUND');
    }

    res.json({ success: true, data: entry });
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
        stopLedger
      );

      notifyStreamWebhooks('stream.created', {
        streamId: result.streamId ?? null,
        txHash: result.hash,
        sender,
        recipient,
        tokenAddress: normalizedTokenAddress,
        totalAmount,
        startLedger,
        stopLedger,
      });

      res.status(201).json({
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

      notifyStreamWebhooks('stream.withdrawn', {
        streamId: Number(streamId),
        amount,
        txHash: result.hash,
      });

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

      notifyStreamWebhooks('stream.canceled', {
        streamId: Number(streamId),
        txHash: result.hash,
      });

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
