const express = require("express");
const Token = require("../models/Token");
const DeploymentAudit = require("../models/DeploymentAudit");
const { asyncHandler, AppError } = require("../middleware/error-handler");
const { logger } = require("../utils/logger");
const { authenticate } = require("../middleware/auth");
const { validateToken } = require("../validators/token-validator");

const router = express.Router();

/**
 * @route GET /api/tokens/:owner
 * @group Tokens - Token management operations
 * @param {string} owner.path - Owner's Stellar public key
 * @returns {Array.<Token>} 200 - Array of tokens owned by the specified address
 * @returns {Error} 400 - Invalid owner public key format
 * @returns {Error} default - Unexpected error
 * @security [JWT]
 */
router.get(
  "/tokens/:owner",
  authenticate,
  asyncHandler(async (req, res) => {
    logger.info("Fetching tokens for owner", {
      correlationId: req.correlationId,
      ownerPublicKey: req.params.owner,
    });
    const tokens = await Token.find({ ownerPublicKey: req.params.owner });
    res.json(tokens);
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

      // Log successful deployment
      await DeploymentAudit.create({
        userId,
        tokenName: name,
        contractId,
        status: "SUCCESS",
      });

      res.status(201).json(newToken);
    } catch (error) {
      logger.error("Token creation failed", {
        correlationId: req.correlationId,
        error: error.message,
      });

      // Log failed deployment attempt
      await DeploymentAudit.create({
        userId,
        tokenName: name,
        contractId,
        status: "FAIL",
        errorMessage: error.message,
      });

      // Re-throw to be handled by error middleware
      throw error;
    }
  }),
);

module.exports = router;
