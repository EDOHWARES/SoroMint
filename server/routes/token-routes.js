const express = require("express");
const Token = require("../models/Token");
const DeploymentAudit = require("../models/DeploymentAudit");
const { asyncHandler } = require("../middleware/error-handler");
const { logger } = require("../utils/logger");
const { authenticate } = require("../middleware/auth");
const { tokenDeploymentRateLimiter } = require("../middleware/rate-limiter");
const {
  validateToken,
  validatePagination,
  validateSearch,
} = require("../validators/token-validator");
const { dispatch } = require("../services/webhook-service");

const createTokenRouter = ({ deployRateLimiter = tokenDeploymentRateLimiter } = {}) => {
  const router = express.Router();

  /**
   * @route GET /api/tokens/:owner
   * @group Tokens - Token management operations
   * @param {string} owner.path - Owner's Stellar public key
   * @param {number} page.query - Page number (default: 1)
   * @param {number} limit.query - Items per page (default: 20)
   * @param {string} search.query - Search query for token name or symbol (case-insensitive)
   * @returns {Object} 200 - Paginated tokens with metadata
   * @returns {Error} 400 - Invalid parameters
   * @returns {Error} default - Unexpected error
   * @security [JWT]
   */
  router.get(
  "/tokens/:owner",
  authenticate,
  validatePagination,
  validateSearch,
  asyncHandler(async (req, res) => {
    const { owner } = req.params;
    const { page, limit, search } = req.query;

    logger.info("Fetching tokens for owner", {
      correlationId: req.correlationId,
      ownerPublicKey: owner,
      page,
      limit,
      search: search || null,
    });

    const skip = (page - 1) * limit;
    const queryFilter = { ownerPublicKey: owner };

    if (search) {
      const searchRegex = new RegExp(search, "i");
      queryFilter.$or = [
        { name: { $regex: searchRegex } },
        { symbol: { $regex: searchRegex } },
      ];

      logger.info("Applying search filter", {
        correlationId: req.correlationId,
        search,
        ownerPublicKey: owner,
      });
    }

    const [tokens, totalCount] = await Promise.all([
      Token.find(queryFilter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit),
      Token.countDocuments(queryFilter),
    ]);

    const totalPages = Math.ceil(totalCount / limit);

    res.json({
      success: true,
      data: tokens,
      metadata: {
        totalCount,
        page,
        totalPages,
        limit,
        search: search || null,
      },
    });
  }),
  );

  /**
   * @route POST /api/tokens
   * @group Tokens - Token management operations
   * @param {TokenCreateInput.model} body.required - Token creation data
   * @returns {Token} 201 - Successfully created token
   * @returns {Error} 400 - Missing required fields or validation error
   * @returns {Error} 409 - Token with this contractId already exists
   * @returns {Error} default - Unexpected error
   * @security [JWT]
   */
  router.post(
  "/tokens",
  deployRateLimiter,
  authenticate,
  validateToken,
  asyncHandler(async (req, res) => {
    const { name, symbol, decimals, contractId, ownerPublicKey } = req.body;
    const userId = req.user._id;

    logger.info("Creating new token", {
      correlationId: req.correlationId,
      name,
      symbol,
      ownerPublicKey,
      userId,
    });

    try {
      const newToken = new Token({
        name,
        symbol,
        decimals,
        contractId,
        ownerPublicKey,
      });
      await newToken.save();

      logger.info("Token created successfully", {
        correlationId: req.correlationId,
        tokenId: newToken._id,
      });

      await DeploymentAudit.create({
        userId,
        tokenName: name,
        contractId,
        status: "SUCCESS",
      });

      dispatch('token.minted', { tokenId: newToken._id, name, symbol, contractId, ownerPublicKey });

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
  }),
  );

  return router;
};

module.exports = createTokenRouter();
module.exports.createTokenRouter = createTokenRouter;
