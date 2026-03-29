const { z } = require("zod");
const { AppError } = require("../middleware/error-handler");
const { logger } = require("../utils/logger");
const DeploymentAudit = require("../models/DeploymentAudit");

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

const paginationSchema = z.object({
  page: z.coerce.number().int().min(1, "Page must be at least 1").default(1),
  limit: z.coerce
    .number()
    .int()
    .min(1, "Limit must be at least 1")
    .max(100, "Limit must not exceed 100")
    .default(20),
});

const searchSchema = z.object({
  search: z
    .string()
    .min(1, "Search query must be at least 1 character")
    .max(50, "Search query must not exceed 50 characters")
    .optional()
    .or(z.literal("").transform(() => undefined)),
});

const validateToken = async (req, res, next) => {
  try {
    req.body = tokenSchema.parse(req.body);
    next();
  } catch (error) {
    if (error instanceof z.ZodError) {
      const errorMessage = error.errors
        .map((entry) => `${entry.path.join(".")}: ${entry.message}`)
        .join(", ");

      logger.warn("Token validation failed", {
        correlationId: req.correlationId,
        errors: error.errors,
      });

      if (req.user?._id) {
        await DeploymentAudit.create({
          userId: req.user._id,
          tokenName: req.body.name || "Unknown",
          status: "FAIL",
          errorMessage: `Validation Error: ${errorMessage}`,
        });
      }

      return next(new AppError(errorMessage, 400, "VALIDATION_ERROR"));
    }

    return next(error);
  }
};

const validatePagination = (req, res, next) => {
  try {
    req.query = { ...req.query, ...paginationSchema.parse(req.query) };
    next();
  } catch (error) {
    if (error instanceof z.ZodError) {
      const errorMessage = error.errors
        .map((entry) => `${entry.path.join(".")}: ${entry.message}`)
        .join(", ");

      return next(new AppError(errorMessage, 400, "VALIDATION_ERROR"));
    }

    return next(error);
  }
};

const SUPPORTED_OPS = ['mint', 'burn', 'transfer'];

const batchOperationSchema = z.object({
  type: z.enum(SUPPORTED_OPS, {
    errorMap: () => ({ message: `type must be one of: ${SUPPORTED_OPS.join(', ')}` }),
  }),
  contractId: z
    .string()
    .length(56, 'contractId must be exactly 56 characters')
    .startsWith('C', 'contractId must start with C'),
  amount: z
    .number({ invalid_type_error: 'amount must be a number' })
    .positive('amount must be positive'),
  destination: z
    .string()
    .length(56, 'destination must be exactly 56 characters')
    .startsWith('G', 'destination must start with G')
    .optional(),
}).superRefine((op, ctx) => {
  if (op.type === 'transfer' && !op.destination) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['destination'], message: 'destination is required for transfer' });
  }
});

const batchSchema = z.object({
  operations: z
    .array(batchOperationSchema)
    .min(1, 'operations must contain at least 1 item')
    .max(20, 'operations must not exceed 20 items'),
  sourcePublicKey: z
    .string()
    .length(56, 'sourcePublicKey must be exactly 56 characters')
    .startsWith('G', 'sourcePublicKey must start with G'),
});

const validateBatch = (req, res, next) => {
  const result = batchSchema.safeParse(req.body);
  if (!result.success) {
    const errors = result.error.errors.map((e) => ({
      path: e.path.join('.'),
      message: e.message,
    }));
    return next(new AppError(
      errors.map((e) => `${e.path}: ${e.message}`).join('; '),
      400,
      'VALIDATION_ERROR'
    ));
  }
  req.body = result.data;
  next();
};

const validateSearch = (req, res, next) => {
  try {
    req.query = { ...req.query, ...searchSchema.parse(req.query) };
    next();
  } catch (error) {
    if (error instanceof z.ZodError) {
      const errorMessage = error.errors
        .map((entry) => `${entry.path.join(".")}: ${entry.message}`)
        .join(", ");

      return next(new AppError(errorMessage, 400, "VALIDATION_ERROR"));
    }

    return next(error);
  }
};

module.exports = {
  tokenSchema,
  paginationSchema,
  searchSchema,
  batchSchema,
  batchOperationSchema,
  validateToken,
  validatePagination,
  validateSearch,
  validateBatch,
};
