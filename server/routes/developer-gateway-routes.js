const express = require('express');
const Token = require('../models/Token');
const { apiKeyAuth } = require('../middleware/api-key-auth');
const { asyncHandler, AppError } = require('../middleware/error-handler');
const { logger } = require('../utils/logger');

/**
 * @title Developer API Gateway Routes
 * @author SoroMint Team
 * @notice Public-facing API surface consumed by third-party developers who
 *         integrate SoroMint into their own products. All routes require a
 *         valid API key provided via the `X-API-Key` header and are subject
 *         to per-key rate limiting and usage tracking.
 *
 *         Mount this router under `/api/v1/developer` so that versioning is
 *         preserved independently of the main application API.
 */

const MAX_PAGE_SIZE = 100;
const DEFAULT_PAGE_SIZE = 25;

const parsePositiveInt = (value, fallback, { max } = {}) => {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  if (max && parsed > max) {
    return max;
  }
  return parsed;
};

const createDeveloperGatewayRouter = () => {
  const router = express.Router();

  /**
   * @route GET /api/v1/developer/health
   * @desc  Simple authenticated ping for integrators to verify credentials
   *        and connectivity. Consumes one call against the key's quota.
   */
  router.get(
    '/health',
    apiKeyAuth(),
    asyncHandler(async (req, res) => {
      res.json({
        success: true,
        data: {
          status: 'ok',
          apiVersion: 'v1',
          keyPrefix: req.apiKey.prefix,
          scopes: req.apiKey.scopes,
          tier: req.apiKey.tier,
          rateLimit: req.apiKey.getRateLimit(),
          serverTime: new Date().toISOString(),
        },
      });
    })
  );

  /**
   * @route GET /api/v1/developer/tokens
   * @desc  List tokens owned by the key's owner, with pagination.
   */
  router.get(
    '/tokens',
    apiKeyAuth({ requiredScopes: ['tokens:read'] }),
    asyncHandler(async (req, res) => {
      const page = parsePositiveInt(req.query.page, 1);
      const limit = parsePositiveInt(req.query.limit, DEFAULT_PAGE_SIZE, {
        max: MAX_PAGE_SIZE,
      });
      const skip = (page - 1) * limit;

      const filter = { ownerPublicKey: req.apiKeyOwnerPublicKey };

      const [tokens, totalCount] = await Promise.all([
        Token.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit),
        Token.countDocuments(filter),
      ]);

      res.json({
        success: true,
        data: tokens,
        metadata: {
          page,
          limit,
          totalCount,
          totalPages: Math.ceil(totalCount / limit),
        },
      });
    })
  );

  /**
   * @route GET /api/v1/developer/tokens/:id
   * @desc  Fetch a single token by id (scoped to the key's owner).
   */
  router.get(
    '/tokens/:id',
    apiKeyAuth({ requiredScopes: ['tokens:read'] }),
    asyncHandler(async (req, res) => {
      const token = await Token.findOne({
        _id: req.params.id,
        ownerPublicKey: req.apiKeyOwnerPublicKey,
      });

      if (!token) {
        throw new AppError('Token not found', 404, 'NOT_FOUND');
      }

      res.json({ success: true, data: token });
    })
  );

  /**
   * @route POST /api/v1/developer/tokens
   * @desc  Register a previously-deployed token for the key's owner.
   *        Deployment itself still happens on-chain — this endpoint records
   *        the contract in SoroMint's index.
   */
  router.post(
    '/tokens',
    apiKeyAuth({ requiredScopes: ['tokens:write'] }),
    asyncHandler(async (req, res) => {
      const { name, symbol, decimals, contractId } = req.body || {};

      if (!name || !symbol || !contractId) {
        throw new AppError(
          'name, symbol and contractId are required',
          400,
          'VALIDATION_ERROR'
        );
      }

      const token = await Token.create({
        name,
        symbol,
        decimals,
        contractId,
        ownerPublicKey: req.apiKeyOwnerPublicKey,
      });

      logger.info('Developer API registered token', {
        correlationId: req.correlationId,
        apiKeyId: req.apiKey._id.toString(),
        tokenId: token._id.toString(),
      });

      res.status(201).json({ success: true, data: token });
    })
  );

  return router;
};

module.exports = createDeveloperGatewayRouter();
module.exports.createDeveloperGatewayRouter = createDeveloperGatewayRouter;
