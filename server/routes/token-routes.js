const express = require('express');
const Token = require('../models/Token');
const DeploymentAudit = require('../models/DeploymentAudit');
const ScanResult = require('../models/ScanResult');
const { asyncHandler, AppError } = require('../middleware/error-handler');
const { logger } = require('../utils/logger');
const { authenticate } = require('../middleware/auth');
const { tokenDeploymentRateLimiter } = require('../middleware/rate-limiter');
const {
  validateToken,
  validatePagination,
  validateSearch,
} = require('../validators/token-validator');
const { dispatch } = require('../services/webhook-service');
const { getCacheService } = require('../services/cache-service');
const { getEnv } = require('../config/env-config');

/**
 * @notice Enforces the optional REQUIRE_SECURITY_SCAN pre-deployment gate.
 *
 * When the REQUIRE_SECURITY_SCAN environment variable is true:
 *   1. A `scanId` field MUST be present in the request body.
 *   2. The scan result identified by that scanId must exist, belong to the
 *      authenticated user, and must NOT have deploymentBlocked = true.
 *
 * When REQUIRE_SECURITY_SCAN is false (default), this middleware is a no-op.
 *
 * @param {object} req   - Express request (req.user._id and req.body.scanId)
 * @param {object} res   - Express response
 * @param {Function} next - Express next
 */
const securityScanGate = asyncHandler(async (req, res, next) => {
  const env = getEnv();

  if (!env.REQUIRE_SECURITY_SCAN) {
    return next();
  }

  const { scanId } = req.body;

  if (!scanId) {
    throw new AppError(
      'Security scan required before deployment. ' +
      'Please scan your WASM contract via POST /api/security/scan and ' +
      'include the returned scanId in this request.',
      400,
      'SCAN_REQUIRED'
    );
  }

  const scan = await ScanResult.findOne({ scanId }).lean();

  if (!scan) {
    throw new AppError(
      `Security scan result not found: ${scanId}. ` +
      'Submit a fresh scan via POST /api/security/scan.',
      404,
      'SCAN_NOT_FOUND'
    );
  }

  // Ownership check — the scan must belong to the authenticated user
  if (String(scan.userId) !== String(req.user._id)) {
    throw new AppError(
      'The provided scanId does not belong to your account.',
      403,
      'FORBIDDEN'
    );
  }

  if (scan.deploymentBlocked) {
    throw new AppError(
      `Deployment blocked: the security scan (${scanId}) found ` +
      `${scan.summary.critical} critical and ${scan.summary.high} high-severity issue(s). ` +
      'Resolve all critical and high findings before deploying.',
      422,
      'SCAN_BLOCKED'
    );
  }

  // Attach scan metadata to the request for downstream use (e.g. audit logs)
  req.securityScan = {
    scanId: scan.scanId,
    status: scan.status,
    wasmHash: scan.wasmHash,
  };

  logger.info('Security scan gate passed', {
    correlationId: req.correlationId,
    scanId,
    scanStatus: scan.status,
    userId: String(req.user._id),
  });

  return next();
});

const createTokenRouter = ({
  deployRateLimiter = tokenDeploymentRateLimiter,
} = {}) => {
  const router = express.Router();

  /**
   * @route GET /api/tokens/:owner
   * @group Tokens - Token management operations
   */
  router.get(
    '/tokens/:owner',
    authenticate,
    validatePagination,
    validateSearch,
    asyncHandler(async (req, res) => {
      const { owner } = req.params;
      const { page, limit, search } = req.query;
      const cacheService = getCacheService();

      logger.info('Fetching tokens for owner', {
        correlationId: req.correlationId,
        ownerPublicKey: owner,
        page,
        limit,
        search: search || null,
      });

      const cacheKey = `tokens:owner:${owner}:page:${page}:limit:${limit}:search:${search || 'none'}`;

      try {
        const cachedResult = await cacheService.get(cacheKey);
        if (cachedResult) {
          logger.debug('Returning cached token list', {
            correlationId: req.correlationId,
            cacheKey,
          });
          return res.json({
            success: true,
            data: cachedResult.data,
            metadata: cachedResult.metadata,
            cached: true,
          });
        }
      } catch (error) {
        logger.warn('Cache retrieval failed, proceeding with database query', {
          correlationId: req.correlationId,
          error: error.message,
        });
      }

      const skip = (page - 1) * limit;
      const queryFilter = { ownerPublicKey: owner };

      if (search) {
        const searchRegex = new RegExp(search, 'i');
        queryFilter.$or = [
          { name: { $regex: searchRegex } },
          { symbol: { $regex: searchRegex } },
        ];
      }

      const [tokens, totalCount] = await Promise.all([
        Token.find(queryFilter).sort({ createdAt: -1 }).skip(skip).limit(limit),
        Token.countDocuments(queryFilter),
      ]);

      const totalPages = Math.ceil(totalCount / limit);

      const result = {
        data: tokens,
        metadata: {
          totalCount,
          page,
          totalPages,
          limit,
          search: search || null,
        },
      };

      try {
        await cacheService.set(cacheKey, result);
      } catch (error) {
        logger.warn('Cache storage failed', {
          correlationId: req.correlationId,
          error: error.message,
        });
      }

      res.json({
        success: true,
        ...result,
        cached: false,
      });
    })
  );

  /**
   * @route POST /api/tokens
   */
  router.post(
    '/tokens',
    deployRateLimiter,
    authenticate,
    securityScanGate,
    validateToken,
    asyncHandler(async (req, res) => {
      const { name, symbol, decimals, contractId, ownerPublicKey } = req.body;
      const userId = req.user._id;
      const scanRef = req.securityScan || null;
      const cacheService = getCacheService();

      const { emitEvent } = require('../utils/socket');

      logger.info('Creating new token', {
        correlationId: req.correlationId,
        name,
        symbol,
        ownerPublicKey,
        userId,
      });

      emitEvent('minting_progress', {
        name,
        symbol,
        status: 'PENDING',
        message: 'Initializing token deployment...'
      }, ownerPublicKey);

      try {
        const newToken = new Token({
          name,
          symbol,
          decimals,
          contractId,
          ownerPublicKey,
        });
        await newToken.save();

        logger.info('Token created successfully', {
          correlationId: req.correlationId,
          tokenId: newToken._id,
          securityScanId: scanRef ? scanRef.scanId : null,
        });

        emitEvent('minting_progress', {
          tokenId: newToken._id,
          name,
          symbol,
          status: 'SUCCESS',
          message: 'Token minted successfully'
        }, ownerPublicKey);

        try {
          await cacheService.deleteByPattern(
            `tokens:owner:${ownerPublicKey}:*`
          );
        } catch (error) {
          logger.warn('Cache invalidation failed after token creation', {
            correlationId: req.correlationId,
            error: error.message,
          });
        }
        dispatch('token.minted', {
          tokenId: newToken._id,
          name,
          symbol,
          contractId,
          ownerPublicKey,
          securityScanId: scanRef ? scanRef.scanId : null,
          securityScanStatus: scanRef ? scanRef.status : null,
          securityWasmHash: scanRef ? scanRef.wasmHash : null,
        });

        res.status(201).json(newToken);
      } catch (error) {
        logger.error('Token creation failed', {
          correlationId: req.correlationId,
          error: error.message,
        });

        emitEvent('minting_progress', {
          name,
          symbol,
          status: 'FAILED',
          message: error.message
        }, ownerPublicKey);

        await DeploymentAudit.create({
          userId,
          tokenName: name,
          contractId,
          status: 'FAIL',
          errorMessage: error.message,
        });

        throw error;
      }
    })
  );

  /**
   * @route GET /api/tokens/metadata/:id
   */
  router.get(
    '/tokens/metadata/:id',
    authenticate,
    asyncHandler(async (req, res) => {
      const { id } = req.params;
      const cacheService = getCacheService();
      const cacheKey = `token:metadata:${id}`;

      const token = await cacheService.getOrSet(cacheKey, async () => {
        const tokenFromDb = await Token.findById(id).lean();
        if (!tokenFromDb) {
          throw new AppError('Token not found', 404, 'NOT_FOUND');
        }
        return tokenFromDb;
      });

      res.json({ success: true, data: token });
    })
  );

  /**
   * @route PUT /api/tokens/metadata/:id
   */
  router.put(
    '/tokens/metadata/:id',
    authenticate,
    asyncHandler(async (req, res) => {
      const { id } = req.params;
      const { name, symbol } = req.body;
      const cacheService = getCacheService();

      const updatedToken = await Token.findByIdAndUpdate(
        id,
        { $set: { name, symbol } },
        { new: true, runValidators: true }
      ).lean();

      if (!updatedToken) {
        throw new AppError('Token not found', 404, 'NOT_FOUND');
      }

      await cacheService.delete(`token:metadata:${id}`);
      if (updatedToken.ownerPublicKey) {
        await cacheService.deleteByPattern(
          `tokens:owner:${updatedToken.ownerPublicKey}:*`
        );
      }

      res.json({ success: true, data: updatedToken });
    })
  );

  return router;
};

module.exports = createTokenRouter();
module.exports.createTokenRouter = createTokenRouter;
module.exports.securityScanGate = securityScanGate;
