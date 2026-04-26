/**
 * @title Bridge Event Validators
 * @description Validates bridge events from Soroban and EVM chains
 * @notice Used by bridge routes to validate cross-chain event payloads
 */

const { z } = require("zod");
const { AppError } = require("../middleware/error-handler");
const { logger } = require("../utils/logger");

const SOURCE_CHAINS = Object.freeze({
  SOROBAN: "soroban",
  EVM: "evm",
});

const ACTION_TYPES = Object.freeze({
  LOCK: "lock",
  RELEASE: "release",
  MINT: "mint",
  BURN: "burn",
  TRANSFER: "transfer",
  DEPOSIT: "deposit",
  WITHDRAW: "withdraw",
});

/**
 * Base schema for bridge events
 */
const bridgeEventSchema = z.object({
  sourceChain: z.enum([SOURCE_CHAINS.SOROBAN, SOURCE_CHAINS.EVM], {
    errorMap: () => ({
      message: `sourceChain must be either '${SOURCE_CHAINS.SOROBAN}' or '${SOURCE_CHAINS.EVM}'`,
    }),
  }),
  event: z.object({
    // Asset information
    symbol: z.string().optional().nullable(),
    contractId: z.string().optional().nullable(),
    assetSymbol: z.string().optional().nullable(),
    token: z.string().optional().nullable(),
    
    // Amount information
    amount: z.union([z.string(), z.number()]).optional().nullable(),
    value: z.union([z.string(), z.number()]).optional().nullable(),
    
    // Action information
    action: z.string().optional().nullable(),
    type: z.string().optional().nullable(),
    
    // Recipient/Destination
    recipient: z.string().optional().nullable(),
    destination: z.string().optional().nullable(),
    to: z.string().optional().nullable(),
    
    // Sender/From
    sender: z.string().optional().nullable(),
    from: z.string().optional().nullable(),
    
    // Event metadata
    id: z.string().optional().nullable(),
    eventId: z.string().optional().nullable(),
    sequence: z.union([z.string(), z.number()]).optional().nullable(),
    transactionHash: z.string().optional().nullable(),
    txHash: z.string().optional().nullable(),
    hash: z.string().optional().nullable(),
    
    // Other possible fields
    ledger: z.union([z.string(), z.number()]).optional().nullable(),
    timestamp: z.union([z.string(), z.number()]).optional().nullable(),
    createdAt: z.string().optional().nullable(),
    
    // Nested details
    details: z.record(z.any()).optional(),
    args: z.record(z.any()).optional(),
    data: z.record(z.any()).optional(),
  }).strict(false), // Allow additional properties
  
  metadata: z
    .object({
      sourceEventId: z.string().optional(),
      sourceTxHash: z.string().optional(),
      sourceLedger: z.union([z.string(), z.number()]).optional(),
      sourceTimestamp: z.string().optional(),
      actor: z.string().optional(),
    })
    .optional(),
});

/**
 * Schema for bridge status query
 */
const bridgeStatusSchema = z.object({
  detailed: z.coerce
    .boolean()
    .optional()
    .default(false),
});

/**
 * Middleware to validate bridge events
 */
const validateBridgeEvent = (req, res, next) => {
  try {
    req.body = bridgeEventSchema.parse(req.body);
    next();
  } catch (error) {
    if (error instanceof z.ZodError) {
      const errorMessage = error.errors
        .map((entry) => `${entry.path.join(".")}: ${entry.message}`)
        .join(", ");

      logger.warn("Bridge event validation failed", {
        correlationId: req.correlationId,
        errors: error.errors,
        body: req.body,
      });

      return next(
        new AppError(errorMessage, 400, "BRIDGE_VALIDATION_ERROR"),
      );
    }

    return next(error);
  }
};

/**
 * Middleware to validate bridge status request
 */
const validateBridgeStatus = (req, res, next) => {
  try {
    req.query = { ...req.query, ...bridgeStatusSchema.parse(req.query) };
    next();
  } catch (error) {
    if (error instanceof z.ZodError) {
      const errorMessage = error.errors
        .map((entry) => `${entry.path.join(".")}: ${entry.message}`)
        .join(", ");

      return next(new AppError(errorMessage, 400, "BRIDGE_VALIDATION_ERROR"));
    }

    return next(error);
  }
};

module.exports = {
  validateBridgeEvent,
  validateBridgeStatus,
  bridgeEventSchema,
  bridgeStatusSchema,
  SOURCE_CHAINS,
  ACTION_TYPES,
};
