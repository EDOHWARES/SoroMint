/**
 * @title Backstop API Validators
 * @description Validates Backstop / insurance fund contract API request payloads
 * @notice Used by backstop routes to validate contract IDs, amounts and fee rates
 *          before they reach the Soroban Backstop contract.
 */

const { z } = require('zod');
const { AppError } = require('../middleware/error-handler');

const MAX_FEE_BPS = 10_000;

/**
 * Stellar account (G...) or contract (C...) address.
 * Stellar public keys are 56 chars: one network-prefixed letter + 55 base32 chars.
 */
const stellarAddressSchema = z
  .string({ required_error: 'Address is required' })
  .min(1, { message: 'Address is required' })
  .regex(/^[GCA][A-Z2-7]{55}$/, {
    message: 'Invalid Stellar address format',
  });

/**
 * Backstop contract identifier (Stellar C-address).
 */
const contractIdSchema = z
  .string({ required_error: 'contractId is required' })
  .regex(/^C[A-Z2-7]{55}$/, {
    message: 'contractId must be a valid Stellar contract (C-address)',
  });

/**
 * Amounts are expressed as integer units (i128 on the contract).
 */
const amountSchema = z
  .number({ required_error: 'amount is required' })
  .int({ message: 'amount must be an integer' })
  .positive({ message: 'amount must be greater than 0' });

/**
 * POST /backstop/:contractId/deposit — mirrors deposit_fee(from, amount)
 */
const depositSchema = z
  .object({
    from: stellarAddressSchema,
    amount: amountSchema,
  })
  .strict();

/**
 * POST /backstop/:contractId/withdraw — mirrors withdraw(to, amount)
 */
const withdrawSchema = z
  .object({
    to: stellarAddressSchema,
    amount: amountSchema,
  })
  .strict();

/**
 * PATCH /backstop/:contractId/fee — mirrors set_fee_bps(fee_bps)
 */
const feeSchema = z
  .object({
    fee_bps: z
      .number({ required_error: 'fee_bps is required' })
      .int({ message: 'fee_bps must be an integer' })
      .min(0, { message: 'fee_bps must be >= 0' })
      .max(MAX_FEE_BPS, { message: `fee_bps must be <= ${MAX_FEE_BPS}` }),
  })
  .strict();

/**
 * @notice Factory that turns a zod parser into an Express validation middleware.
 * @param {Function} parse - A function (req) => parsed value.
 * @param {string} code - Application error code for validation failures.
 */
const createValidationMiddleware = (parse, code) => (req, res, next) => {
  try {
    parse(req);
    return next();
  } catch (error) {
    if (error instanceof z.ZodError) {
      // zod v4 exposes issues; v3 exposes errors. Support both.
      const issues = error.issues || error.errors || [];
      const errorMessage = issues
        .map((entry) => `${entry.path.join('.') || 'body'}: ${entry.message}`)
        .join(', ');
      return next(new AppError(errorMessage, 400, code));
    }
    return next(error);
  }
};

/**
 * Validates the :contractId path parameter.
 */
const validateContractId = createValidationMiddleware(
  (req) => {
    req.params = { ...req.params, contractId: contractIdSchema.parse(req.params.contractId) };
  },
  'BACKSTOP_VALIDATION_ERROR'
);

/**
 * Validates the deposit_fee request body.
 */
const validateDeposit = createValidationMiddleware(
  (req) => {
    req.body = { ...req.body, ...depositSchema.parse(req.body) };
  },
  'BACKSTOP_VALIDATION_ERROR'
);

/**
 * Validates the withdraw request body.
 */
const validateWithdraw = createValidationMiddleware(
  (req) => {
    req.body = { ...req.body, ...withdrawSchema.parse(req.body) };
  },
  'BACKSTOP_VALIDATION_ERROR'
);

/**
 * Validates the set_fee_bps request body.
 */
const validateFee = createValidationMiddleware(
  (req) => {
    req.body = { ...req.body, ...feeSchema.parse(req.body) };
  },
  'BACKSTOP_VALIDATION_ERROR'
);

module.exports = {
  validateContractId,
  validateDeposit,
  validateWithdraw,
  validateFee,
  contractIdSchema,
  depositSchema,
  withdrawSchema,
  feeSchema,
  stellarAddressSchema,
  amountSchema,
  MAX_FEE_BPS,
};
