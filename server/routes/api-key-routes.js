'use strict';

const express = require('express');
const { z } = require('zod');
const ApiKey = require('../models/ApiKey');
const ApiUsage = require('../models/ApiUsage');
const { authenticate } = require('../middleware/auth');
const { asyncHandler, AppError } = require('../middleware/error-handler');
const { logger } = require('../utils/logger');

const createSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, 'name is required')
    .max(100, 'name must be at most 100 characters'),
  tier: z.enum(ApiKey.VALID_TIERS).optional(),
  scopes: z.array(z.enum(ApiKey.VALID_SCOPES)).nonempty().optional(),
  rateLimit: z
    .object({
      windowMs: z.number().int().min(1000),
      max: z.number().int().min(1),
    })
    .optional(),
  expiresAt: z
    .union([z.string().datetime(), z.null()])
    .optional()
    .transform((value) => (value ? new Date(value) : null)),
});

const updateSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  tier: z.enum(ApiKey.VALID_TIERS).optional(),
  scopes: z.array(z.enum(ApiKey.VALID_SCOPES)).nonempty().optional(),
  rateLimit: z
    .object({
      windowMs: z.number().int().min(1000),
      max: z.number().int().min(1),
    })
    .nullable()
    .optional(),
  expiresAt: z
    .union([z.string().datetime(), z.null()])
    .optional()
    .transform((value) =>
      value === undefined ? undefined : value ? new Date(value) : null
    ),
});

const parseOrThrow = (schema, payload) => {
  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    const message = parsed.error.issues
      .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join(', ');
    throw new AppError(message, 400, 'VALIDATION_ERROR');
  }
  return parsed.data;
};

const findOwnedKey = async (id, ownerPublicKey) => {
  const apiKey = await ApiKey.findOne({ _id: id, ownerPublicKey });
  if (!apiKey) {
    throw new AppError('API key not found', 404, 'NOT_FOUND');
  }
  return apiKey;
};

const createApiKeyRouter = () => {
  const router = express.Router();

  /**
   * @openapi
   * @route POST /api/api-keys
   * @name createApiKey
   * @description Issue a new API key for the authenticated user. The plaintext value is returned exactly once in this response.
   * @tags API Keys
   * @security BearerAuth
   * @param {string} name - API key name (required, 1-100 chars)
   * @param {string} tier - Tier level (optional, e.g., 'free', 'pro')
   * @param {array} scopes - Permission scopes array (optional)
   * @param {object} rateLimit - Rate limit configuration (optional)
   * @param {string} expiresAt - Expiration datetime ISO string (optional)
   * @returns {object} 201 - Created API key with plaintext (shown once only)
   */
  router.post(
    '/',
    authenticate,
    asyncHandler(async (req, res) => {
      const data = parseOrThrow(createSchema, req.body);

      const plaintext = ApiKey.generatePlaintext();
      const keyHash = ApiKey.hashKey(plaintext);
      const prefix = ApiKey.derivePrefix(plaintext);

      const apiKey = await ApiKey.create({
        ownerPublicKey: req.user.publicKey,
        name: data.name,
        tier: data.tier || 'free',
        scopes: data.scopes || ['tokens:read'],
        rateLimit: data.rateLimit || undefined,
        expiresAt: data.expiresAt || null,
        prefix,
        keyHash,
      });

      logger.info('Issued developer API key', {
        correlationId: req.correlationId,
        apiKeyId: apiKey._id.toString(),
        ownerPublicKey: req.user.publicKey,
      });

      res.status(201).json({
        success: true,
        data: {
          ...apiKey.toSafeJSON(),
          key: plaintext,
          warning:
            'Store this key securely. It cannot be retrieved again after this response.',
        },
      });
    })
  );

  /**
   * @openapi
   * @route GET /api/api-keys
   * @name listApiKeys
   * @description List the authenticated user's API keys (no plaintext)
   * @tags API Keys
   * @security BearerAuth
   * @returns {array} 200 - Array of API keys
   */
  router.get(
    '/',
    authenticate,
    asyncHandler(async (req, res) => {
      const keys = await ApiKey.find({
        ownerPublicKey: req.user.publicKey,
      }).sort({ createdAt: -1 });

      res.json({
        success: true,
        data: keys.map((key) => key.toSafeJSON()),
      });
    })
  );

  /**
   * @openapi
   * @route GET /api/api-keys/{id}
   * @name getApiKey
   * @description Fetch a single API key by ID
   * @tags API Keys
   * @security BearerAuth
   * @param {string} id - API key ID
   * @returns {object} 200 - API key details
   */
  router.get(
    '/:id',
    authenticate,
    asyncHandler(async (req, res) => {
      const apiKey = await findOwnedKey(req.params.id, req.user.publicKey);
      res.json({ success: true, data: apiKey.toSafeJSON() });
    })
  );

  /**
   * @openapi
   * @route PATCH /api/api-keys/{id}
   * @name updateApiKey
   * @description Update mutable fields of an API key (name, tier, scopes, rateLimit, expiresAt)
   * @tags API Keys
   * @security BearerAuth
   * @param {string} id - API key ID
   * @param {string} name - New name (optional)
   * @param {string} tier - New tier (optional)
   * @param {array} scopes - New scopes array (optional)
   * @param {object} rateLimit - New rate limit (optional)
   * @param {string} expiresAt - New expiration datetime (optional)
   * @returns {object} 200 - Updated API key
   */
  router.patch(
    '/:id',
    authenticate,
    asyncHandler(async (req, res) => {
      const data = parseOrThrow(updateSchema, req.body);
      const apiKey = await findOwnedKey(req.params.id, req.user.publicKey);

      if (data.name !== undefined) apiKey.name = data.name;
      if (data.tier !== undefined) apiKey.tier = data.tier;
      if (data.scopes !== undefined) apiKey.scopes = data.scopes;
      if (data.rateLimit !== undefined) {
        apiKey.rateLimit = data.rateLimit || undefined;
      }
      if (data.expiresAt !== undefined) apiKey.expiresAt = data.expiresAt;

      await apiKey.save();

      res.json({ success: true, data: apiKey.toSafeJSON() });
    })
  );

  /**
   * @openapi
   * @route POST /api/api-keys/{id}/rotate
   * @name rotateApiKey
   * @description Invalidate the current secret and issue a new plaintext value
   * @tags API Keys
   * @security BearerAuth
   * @param {string} id - API key ID
   * @returns {object} 200 - New API key with plaintext (shown once only)
   */
  router.post(
    '/:id/rotate',
    authenticate,
    asyncHandler(async (req, res) => {
      const apiKey = await findOwnedKey(req.params.id, req.user.publicKey);

      const plaintext = ApiKey.generatePlaintext();
      apiKey.keyHash = ApiKey.hashKey(plaintext);
      apiKey.prefix = ApiKey.derivePrefix(plaintext);
      apiKey.status = 'active';
      await apiKey.save();

      logger.info('Rotated developer API key', {
        correlationId: req.correlationId,
        apiKeyId: apiKey._id.toString(),
        ownerPublicKey: req.user.publicKey,
      });

      res.json({
        success: true,
        data: {
          ...apiKey.toSafeJSON(),
          key: plaintext,
          warning:
            'Store this key securely. It cannot be retrieved again after this response.',
        },
      });
    })
  );

  /**
   * @openapi
   * @route POST /api/api-keys/{id}/revoke
   * @name revokeApiKey
   * @description Permanently disable the API key
   * @tags API Keys
   * @security BearerAuth
   * @param {string} id - API key ID
   * @returns {object} 200 - Revoked API key
   */
  router.post(
    '/:id/revoke',
    authenticate,
    asyncHandler(async (req, res) => {
      const apiKey = await findOwnedKey(req.params.id, req.user.publicKey);
      apiKey.status = 'revoked';
      await apiKey.save();

      res.json({ success: true, data: apiKey.toSafeJSON() });
    })
  );

  /**
   * @openapi
   * @route DELETE /api/api-keys/{id}
   * @name deleteApiKey
   * @description Delete the API key and all associated usage records
   * @tags API Keys
   * @security BearerAuth
   * @param {string} id - API key ID
   * @returns {object} 200 - Success confirmation
   */
  router.delete(
    '/:id',
    authenticate,
    asyncHandler(async (req, res) => {
      const apiKey = await findOwnedKey(req.params.id, req.user.publicKey);
      await ApiUsage.deleteMany({ apiKeyId: apiKey._id });
      await apiKey.deleteOne();

      res.json({ success: true });
    })
  );

  /**
   * @openapi
   * @route GET /api/api-keys/{id}/usage
   * @name getApiKeyUsage
   * @description Aggregated usage stats for an API key over the given time window
   * @tags API Keys
   * @security BearerAuth
   * @param {string} id - API key ID
   * @param {string} from - Start timestamp ISO string (optional, defaults to 24h ago)
   * @param {string} to - End timestamp ISO string (optional, defaults to now)
   * @returns {object} 200 - Usage statistics including total requests, status breakdown, and top endpoints
   */
  router.get(
    '/:id/usage',
    authenticate,
    asyncHandler(async (req, res) => {
      const apiKey = await findOwnedKey(req.params.id, req.user.publicKey);

      const to = req.query.to ? new Date(req.query.to) : new Date();
      const from = req.query.from
        ? new Date(req.query.from)
        : new Date(to.getTime() - 24 * 60 * 60 * 1000);

      if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
        throw new AppError(
          'Invalid from/to timestamp',
          400,
          'VALIDATION_ERROR'
        );
      }

      const match = {
        apiKeyId: apiKey._id,
        timestamp: { $gte: from, $lte: to },
      };

      const [totalRequests, statusBreakdown, pathBreakdown] = await Promise.all(
        [
          ApiUsage.countDocuments(match),
          ApiUsage.aggregate([
            { $match: match },
            { $group: { _id: '$statusCode', count: { $sum: 1 } } },
            { $sort: { _id: 1 } },
          ]),
          ApiUsage.aggregate([
            { $match: match },
            {
              $group: {
                _id: { method: '$method', path: '$path' },
                count: { $sum: 1 },
                avgDurationMs: { $avg: '$durationMs' },
              },
            },
            { $sort: { count: -1 } },
            { $limit: 20 },
          ]),
        ]
      );

      res.json({
        success: true,
        data: {
          apiKeyId: apiKey._id,
          from,
          to,
          totalRequests,
          byStatus: statusBreakdown.map((row) => ({
            statusCode: row._id,
            count: row.count,
          })),
          topEndpoints: pathBreakdown.map((row) => ({
            method: row._id.method,
            path: row._id.path,
            count: row.count,
            avgDurationMs: Math.round(row.avgDurationMs || 0),
          })),
          rateLimit: apiKey.getRateLimit(),
        },
      });
    })
  );

  return router;
};

module.exports = createApiKeyRouter();
module.exports.createApiKeyRouter = createApiKeyRouter;
