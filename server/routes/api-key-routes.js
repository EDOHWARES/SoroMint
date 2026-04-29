const express = require('express');
const { z } = require('zod');
const ApiKey = require('../models/ApiKey');
const ApiUsage = require('../models/ApiUsage');
const { authenticate } = require('../middleware/auth');
const { asyncHandler, AppError } = require('../middleware/error-handler');
const { logger } = require('../utils/logger');

/**
 * @title API Key Management Routes
 * @author SoroMint Team
 * @notice JWT-authenticated endpoints allowing users to create, list, rotate,
 *         update, revoke, and inspect usage of their developer API keys.
 *         The Developer API Gateway itself is defined in
 *         developer-gateway-routes.js and authenticates via the API key.
 */

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
   * @route POST /api/api-keys
   * @desc  Issue a new API key for the authenticated user. The plaintext
   *        value is returned exactly once in this response.
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
   * @route GET /api/api-keys
   * @desc  List the authenticated user's API keys (no plaintext).
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
   * @route GET /api/api-keys/:id
   * @desc  Fetch a single API key by id.
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
   * @route PATCH /api/api-keys/:id
   * @desc  Update mutable fields (name, tier, scopes, rateLimit, expiresAt).
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
   * @route POST /api/api-keys/:id/rotate
   * @desc  Invalidate the current secret and issue a new plaintext value.
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
   * @route POST /api/api-keys/:id/revoke
   * @desc  Permanently disable the API key.
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
   * @route DELETE /api/api-keys/:id
   * @desc  Delete the API key and all associated usage records.
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
   * @route GET /api/api-keys/:id/usage
   * @desc  Aggregated usage stats for a key over the given window.
   * @query {string} [from] - ISO timestamp, defaults to 24h ago
   * @query {string} [to]   - ISO timestamp, defaults to now
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
