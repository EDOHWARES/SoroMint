'use strict';

const express = require('express');
const Token = require('../models/Token');
const { apiKeyAuth } = require('../middleware/api-key-auth');
const { asyncHandler, AppError } = require('../middleware/error-handler');
const { logger } = require('../utils/logger');

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
   * @openapi
   * @route GET /api/v1/developer/health
   * @name developerHealth
   * @description Verify API credentials and connectivity (consumes one call against key quota)
   * @tags Developer Gateway
   * @security ApiKeyAuth
   * @returns {object} 200 - Health status with key metadata
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
   * @openapi
   * @route GET /api/v1/developer/tokens
   * @name developerListTokens
   * @description List tokens owned by the API key's owner with pagination
   * @tags Developer Gateway
   * @security ApiKeyAuth
   * @param {integer} page - Page number (optional, default: 1)
   * @param {integer} limit - Results per page (optional, default: 25, max: 100)
   * @returns {object} 200 - Token list with pagination metadata
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
   * @openapi
   * @route GET /api/v1/developer/tokens/{id}
   * @name developerGetToken
   * @description Fetch a single token by ID (scoped to the key's owner)
   * @tags Developer Gateway
   * @security ApiKeyAuth
   * @param {string} id - Token ID
   * @returns {object} 200 - Token data
   * @returns {object} 404 - Token not found
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
   * @openapi
   * @route POST /api/v1/developer/tokens
   * @name developerRegisterToken
   * @description Register a previously-deployed token for the key's owner
   * @tags Developer Gateway
   * @security ApiKeyAuth
   * @param {string} name - Token name
   * @param {string} symbol - Token symbol
   * @param {integer} decimals - Token decimals
   * @param {string} contractId - Token contract ID (C...)
   * @returns {object} 201 - Token registered successfully
   * @returns {object} 400 - Validation error
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
