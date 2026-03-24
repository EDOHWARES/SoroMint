const { z } = require("zod");
const { AppError } = require("../middleware/error-handler");
const { logger } = require("../utils/logger");
const DeploymentAudit = require("../models/DeploymentAudit");

/**
 * @title Token Validation Schema
 * @dev Validates the request body for token creation.
 *      Enforces naming conventions and Soroban/Stellar address formats.
 */
const tokenSchema = z.object({
  name: z
    .string()
    .min(3, "Token name must be at least 3 characters long")
    .max(50, "Token name must not exceed 50 characters"),
  symbol: z
    .string()
    .min(2, "Token symbol must be at least 2 characters long")
    .max(12, "Token symbol must not exceed 12 characters")
    .regex(/^[A-Z0-9]+$/, "Token symbol must be alphanumeric and uppercase"),
  decimals: z
    .number()
    .int()
    .min(0, "Decimals must be at least 0")
    .max(18, "Decimals must not exceed 18")
    .optional()
    .default(7),
  contractId: z
    .string()
    .length(56, "Contract ID must be exactly 56 characters")
    .startsWith("C", "Contract ID must start with C"),
  ownerPublicKey: z
    .string()
    .length(56, "Owner Public Key must be exactly 56 characters")
    .startsWith("G", "Owner Public Key must start with G"),
});

/**
 * @notice Middleware for validating token creation requests
 * @dev Uses Zod to validate req.body and logs failures to DeploymentAudit.
 *      Expects req.user to be populated by authentication middleware.
 */
const validateToken = async (req, res, next) => {
  try {
    // Validate and transform the request body
    const validatedData = tokenSchema.parse(req.body);
    req.body = validatedData;
    next();
  } catch (error) {
    if (error instanceof z.ZodError) {
      const errorMessage = error.errors
        .map((e) => `${e.path.join(".")}: ${e.message}`)
        .join(", ");

      logger.warn("Token validation failed", {
        correlationId: req.correlationId,
        errors: error.errors,
      });

      // Log failed attempt due to validation
      const userId = req.user ? req.user._id : null;

      if (userId) {
        await DeploymentAudit.create({
          userId,
          tokenName: req.body.name || "Unknown",
          status: "FAIL",
          errorMessage: `Validation Error: ${errorMessage}`,
        });
      }

      return next(new AppError(errorMessage, 400, "VALIDATION_ERROR"));
    }
    next(error);
  }
};

module.exports = {
  tokenSchema,
  validateToken,
};
