const express = require("express");
const Token = require("../models/Token");
const DeploymentAudit = require("../models/DeploymentAudit");
const { asyncHandler, AppError } = require("../middleware/error-handler");
const { logger } = require("../utils/logger");
const { authenticate } = require("../middleware/auth");
const { tokenDeploymentRateLimiter } = require("../middleware/rate-limiter");
const {
  validateToken,
  validatePagination,
  validateSearch,
} = require("../validators/token-validator");
const { dispatch } = require("../services/webhook-service");
const { getCacheService } = require("../services/cache-service");
const ipfsService = require("../services/ipfs-service");
const stellarService = require("../services/stellar-service");

const createTokenRouter = ({ deployRateLimiter = tokenDeploymentRateLimiter } = {}) => {
  const router = express.Router();

  /**
   * @route GET /api/tokens/:owner
   * @group Tokens - Token management operations
   */
  router.get(
    "/tokens/:owner",
    authenticate,
    validatePagination,
    validateSearch,
    asyncHandler(async (req, res) => {
      const { owner } = req.params;
      const { page, limit, search } = req.query;
      const cacheService = getCacheService();

      logger.info("Fetching tokens for owner", {
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
          logger.debug("Returning cached token list", {
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
        logger.warn("Cache retrieval failed, proceeding with database query", {
          correlationId: req.correlationId,
          error: error.message,
        });
      }

      const skip = (page - 1) * limit;
      const queryFilter = { ownerPublicKey: owner };

      if (search) {
        const searchRegex = new RegExp(search, "i");
        queryFilter.$or = [
          { name: { $regex: searchRegex } },
          { symbol: { $regex: searchRegex } },
        ];
      }

      const [tokens, totalCount] = await Promise.all([
        Token.find(queryFilter)
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(limit),
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
        logger.warn("Cache storage failed", {
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
    "/tokens",
    deployRateLimiter,
    authenticate,
    validateToken,
    asyncHandler(async (req, res) => {
      const { name, symbol, decimals, contractId, ownerPublicKey, description, iconBase64 } = req.body;
      const userId = req.user._id;
      const cacheService = getCacheService();

      logger.info("Creating new token", {
        correlationId: req.correlationId,
        name,
        symbol,
        ownerPublicKey,
        userId,
      });

      try {
        let ipfsIconCid = null;
        let ipfsMetadataCid = null;

        // 1. Pin Icon to IPFS
        if (iconBase64) {
          logger.info("Pinning icon to IPFS", { correlationId: req.correlationId });
          ipfsIconCid = await ipfsService.pinFileToIPFS(iconBase64, `${symbol}-icon`);
        }

        // 2. Pin JSON Metadata to IPFS
        const tokenMetadata = {
          name,
          symbol,
          description: description || `Token ${name}`,
          decimals,
          image: ipfsIconCid ? `ipfs://${ipfsIconCid}` : null,
        };

        logger.info("Pinning metadata to IPFS", { correlationId: req.correlationId });
        ipfsMetadataCid = await ipfsService.pinJSONToIPFS(tokenMetadata, `${symbol}-metadata.json`);

        // 3. Save to DB
        const newToken = new Token({
          name,
          symbol,
          decimals,
          contractId,
          ownerPublicKey,
          description,
          ipfsIconCid,
          ipfsMetadataCid,
        });
        await newToken.save();

        logger.info("Token created successfully", {
          correlationId: req.correlationId,
          tokenId: newToken._id,
        });

        // 4. Update Smart Contract Metadata Hash (if admin key configured)
        if (ipfsMetadataCid) {
          logger.info("Updating smart contract metadata hash", {
            correlationId: req.correlationId,
            contractId,
            ipfsMetadataCid,
          });
          // This happens asynchronously to not block the response
          stellarService.setContractMetadataHash(contractId, ipfsMetadataCid)
            .then(result => {
              if (result.success) {
                logger.info("Smart contract metadata hash updated", { contractId, txHash: result.txHash });
              } else {
                logger.warn("Failed to update smart contract metadata hash", { contractId, error: result.error });
              }
            })
            .catch(e => logger.error("Error setting metadata hash", { error: e.message }));
        }

        try {
          await cacheService.deleteByPattern(`tokens:owner:${ownerPublicKey}:*`);
        } catch (error) {
          logger.warn("Cache invalidation failed after token creation", {
            correlationId: req.correlationId,
            error: error.message,
          });
        }
        dispatch('token.minted', { tokenId: newToken._id, name, symbol, contractId, ownerPublicKey, ipfsMetadataCid });

        res.status(201).json(newToken);
      } catch (error) {
        logger.error("Token creation failed", {
          correlationId: req.correlationId,
          error: error.message,
        });

        await DeploymentAudit.create({
          userId,
          tokenName: name,
          contractId,
          status: "FAIL",
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
    "/tokens/metadata/:id",
    authenticate,
    asyncHandler(async (req, res) => {
      const { id } = req.params;
      const cacheService = getCacheService();
      const cacheKey = `token:metadata:${id}`;

      const token = await cacheService.getOrSet(
        cacheKey,
        async () => {
          const tokenFromDb = await Token.findById(id).lean();
          if (!tokenFromDb) {
            throw new AppError("Token not found", 404, "NOT_FOUND");
          }
          return tokenFromDb;
        }
      );

      res.json({ success: true, data: token });
    })
  );

  /**
   * @route PUT /api/tokens/metadata/:id
   */
  router.put(
    "/tokens/metadata/:id",
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
        throw new AppError("Token not found", 404, "NOT_FOUND");
      }

      await cacheService.delete(`token:metadata:${id}`);
      if (updatedToken.ownerPublicKey) {
        await cacheService.deleteByPattern(`tokens:owner:${updatedToken.ownerPublicKey}:*`);
      }

      res.json({ success: true, data: updatedToken });
    })
  );

  return router;
};

module.exports = createTokenRouter();
module.exports.createTokenRouter = createTokenRouter;
