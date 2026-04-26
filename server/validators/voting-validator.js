'use strict';

const { z } = require('zod');
const { AppError } = require('../middleware/error-handler');
const { logger } = require('../utils/logger');

// ---------------------------------------------------------------------------
// Reusable field schemas
// ---------------------------------------------------------------------------

const stellarPublicKey = z
  .string()
  .length(56, 'Must be exactly 56 characters')
  .regex(/^G[A-Z2-7]{55}$/, 'Must be a valid Stellar G-address (starts with G)');

const stellarContractId = z
  .string()
  .length(56, 'Must be exactly 56 characters')
  .regex(/^C[A-Z2-7]{55}$/, 'Must be a valid Stellar C-address (starts with C)');

// ---------------------------------------------------------------------------
// Proposal creation schema
// ---------------------------------------------------------------------------

/**
 * @notice Schema for POST /api/proposals
 * @dev startTime must be in the future; endTime must be after startTime.
 *      Minimum voting window: 1 hour. Maximum: 90 days.
 */
const createProposalSchema = z
  .object({
    title: z
      .string({ required_error: 'title is required' })
      .trim()
      .min(3, 'title must be at least 3 characters')
      .max(200, 'title must not exceed 200 characters'),

    description: z
      .string({ required_error: 'description is required' })
      .trim()
      .min(10, 'description must be at least 10 characters')
      .max(10000, 'description must not exceed 10000 characters'),

    choices: z
      .array(
        z
          .string()
          .trim()
          .min(1, 'Each choice must be a non-empty string')
          .max(100, 'Each choice must not exceed 100 characters'),
        { required_error: 'choices is required' }
      )
      .min(2, 'At least 2 choices are required')
      .max(10, 'At most 10 choices are allowed'),

    startTime: z
      .string({ required_error: 'startTime is required' })
      .datetime({ message: 'startTime must be a valid ISO 8601 date-time string' })
      .transform((v) => new Date(v)),

    endTime: z
      .string({ required_error: 'endTime is required' })
      .datetime({ message: 'endTime must be a valid ISO 8601 date-time string' })
      .transform((v) => new Date(v)),

    contractId: stellarContractId
      .nullable()
      .optional()
      .default(null),

    tags: z
      .array(
        z
          .string()
          .trim()
          .min(1, 'Each tag must be a non-empty string')
          .max(30, 'Each tag must not exceed 30 characters')
      )
      .max(10, 'At most 10 tags are allowed')
      .optional()
      .default([]),

    discussionUrl: z
      .string()
      .trim()
      .url('discussionUrl must be a valid URL')
      .nullable()
      .optional()
      .default(null),
  })
  .superRefine((data, ctx) => {
    const now = new Date();
    const ONE_HOUR_MS = 60 * 60 * 1000;
    const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;

    // startTime must be in the future (allow 60s grace for clock skew)
    if (data.startTime <= new Date(now.getTime() - 60_000)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['startTime'],
        message: 'startTime must be in the future',
      });
    }

    // endTime must be strictly after startTime
    if (data.endTime <= data.startTime) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['endTime'],
        message: 'endTime must be after startTime',
      });
    }

    // Minimum voting window: 1 hour
    const durationMs = data.endTime.getTime() - data.startTime.getTime();
    if (durationMs < ONE_HOUR_MS) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['endTime'],
        message: 'Voting window must be at least 1 hour',
      });
    }

    // Maximum voting window: 90 days
    if (durationMs > NINETY_DAYS_MS) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['endTime'],
        message: 'Voting window must not exceed 90 days',
      });
    }

    // Choices must be unique (case-insensitive)
    const lower = data.choices.map((c) => c.toLowerCase());
    const unique = new Set(lower);
    if (unique.size !== lower.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['choices'],
        message: 'Choices must be unique (case-insensitive)',
      });
    }
  });

// ---------------------------------------------------------------------------
// Proposal update schema
// ---------------------------------------------------------------------------

/**
 * @notice Schema for PATCH /api/proposals/:id
 * @dev Only fields that can be changed while a proposal is still pending.
 *      At least one field must be provided.
 */
const updateProposalSchema = z
  .object({
    title: z
      .string()
      .trim()
      .min(3, 'title must be at least 3 characters')
      .max(200, 'title must not exceed 200 characters')
      .optional(),

    description: z
      .string()
      .trim()
      .min(10, 'description must be at least 10 characters')
      .max(10000, 'description must not exceed 10000 characters')
      .optional(),

    choices: z
      .array(
        z
          .string()
          .trim()
          .min(1, 'Each choice must be a non-empty string')
          .max(100, 'Each choice must not exceed 100 characters')
      )
      .min(2, 'At least 2 choices are required')
      .max(10, 'At most 10 choices are allowed')
      .optional(),

    startTime: z
      .string()
      .datetime({ message: 'startTime must be a valid ISO 8601 date-time string' })
      .transform((v) => new Date(v))
      .optional(),

    endTime: z
      .string()
      .datetime({ message: 'endTime must be a valid ISO 8601 date-time string' })
      .transform((v) => new Date(v))
      .optional(),

    tags: z
      .array(
        z
          .string()
          .trim()
          .min(1, 'Each tag must be a non-empty string')
          .max(30, 'Each tag must not exceed 30 characters')
      )
      .max(10, 'At most 10 tags are allowed')
      .optional(),

    discussionUrl: z
      .string()
      .trim()
      .url('discussionUrl must be a valid URL')
      .nullable()
      .optional(),
  })
  .refine(
    (data) => Object.keys(data).length > 0,
    { message: 'At least one field must be provided for update' }
  )
  .superRefine((data, ctx) => {
    if (data.startTime && data.endTime) {
      const ONE_HOUR_MS = 60 * 60 * 1000;
      const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;

      if (data.endTime <= data.startTime) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['endTime'],
          message: 'endTime must be after startTime',
        });
      }

      const durationMs = data.endTime.getTime() - data.startTime.getTime();
      if (durationMs < ONE_HOUR_MS) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['endTime'],
          message: 'Voting window must be at least 1 hour',
        });
      }

      if (durationMs > NINETY_DAYS_MS) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['endTime'],
          message: 'Voting window must not exceed 90 days',
        });
      }
    }

    if (data.choices) {
      const lower = data.choices.map((c) => c.toLowerCase());
      const unique = new Set(lower);
      if (unique.size !== lower.length) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['choices'],
          message: 'Choices must be unique (case-insensitive)',
        });
      }
    }
  });

// ---------------------------------------------------------------------------
// Vote casting schema
// ---------------------------------------------------------------------------

/**
 * @notice Schema for POST /api/proposals/:id/votes
 */
const castVoteSchema = z.object({
  choice: z
    .number({ required_error: 'choice is required', invalid_type_error: 'choice must be a number' })
    .int('choice must be an integer')
    .min(0, 'choice must be a non-negative integer'),

  signedMessage: z
    .string()
    .trim()
    .min(1, 'signedMessage must not be empty if provided')
    .nullable()
    .optional()
    .default(null),
});

// ---------------------------------------------------------------------------
// Proposal list query schema
// ---------------------------------------------------------------------------

/**
 * @notice Schema for GET /api/proposals query params
 */
const listProposalsQuerySchema = z.object({
  status: z
    .enum(['pending', 'active', 'closed', 'cancelled', 'all'], {
      message: "status must be one of: pending, active, closed, cancelled, all",
    })
    .optional()
    .default('all'),

  contractId: stellarContractId.optional(),

  creator: stellarPublicKey.optional(),

  page: z.coerce
    .number()
    .int()
    .min(1, 'page must be at least 1')
    .optional()
    .default(1),

  limit: z.coerce
    .number()
    .int()
    .min(1, 'limit must be at least 1')
    .max(100, 'limit must not exceed 100')
    .optional()
    .default(20),

  sortBy: z
    .enum(['createdAt', 'startTime', 'endTime', 'voteCount', 'totalVotingPower'], {
      message: 'sortBy must be one of: createdAt, startTime, endTime, voteCount, totalVotingPower',
    })
    .optional()
    .default('createdAt'),

  sortOrder: z
    .enum(['asc', 'desc'], { message: "sortOrder must be 'asc' or 'desc'" })
    .optional()
    .default('desc'),

  search: z
    .string()
    .trim()
    .min(1, 'search must not be empty if provided')
    .max(100, 'search query must not exceed 100 characters')
    .optional(),

  tags: z
    .string()
    .trim()
    .optional()
    .transform((v) => (v ? v.split(',').map((t) => t.trim()).filter(Boolean) : undefined)),
});

// ---------------------------------------------------------------------------
// Votes list query schema
// ---------------------------------------------------------------------------

/**
 * @notice Schema for GET /api/proposals/:id/votes query params
 */
const listVotesQuerySchema = z.object({
  page: z.coerce
    .number()
    .int()
    .min(1)
    .optional()
    .default(1),

  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(100)
    .optional()
    .default(20),

  choice: z.coerce
    .number()
    .int()
    .min(0)
    .optional(),
});

// ---------------------------------------------------------------------------
// Middleware factories
// ---------------------------------------------------------------------------

/**
 * @notice Builds an Express middleware that validates req.body against a
 *         Zod schema and calls next() on success, or next(AppError) on failure.
 * @param {z.ZodSchema} schema
 * @returns {Function} Express middleware
 */
const validateBody = (schema) => (req, res, next) => {
  const result = schema.safeParse(req.body);

  if (!result.success) {
    const message = result.error.errors
      .map((e) => `${e.path.join('.') || 'body'}: ${e.message}`)
      .join('; ');

    logger.warn('Voting request body validation failed', {
      correlationId: req.correlationId,
      errors: result.error.errors,
      path: req.path,
      method: req.method,
    });

    return next(new AppError(message, 400, 'VALIDATION_ERROR'));
  }

  req.body = result.data;
  next();
};

/**
 * @notice Builds an Express middleware that validates req.query against a
 *         Zod schema and merges the coerced/defaulted values back.
 * @param {z.ZodSchema} schema
 * @returns {Function} Express middleware
 */
const validateQuery = (schema) => (req, res, next) => {
  const result = schema.safeParse(req.query);

  if (!result.success) {
    const message = result.error.errors
      .map((e) => `${e.path.join('.') || 'query'}: ${e.message}`)
      .join('; ');

    logger.warn('Voting request query validation failed', {
      correlationId: req.correlationId,
      errors: result.error.errors,
      path: req.path,
      method: req.method,
    });

    return next(new AppError(message, 400, 'VALIDATION_ERROR'));
  }

  req.query = { ...req.query, ...result.data };
  next();
};

// ---------------------------------------------------------------------------
// Named middleware exports
// ---------------------------------------------------------------------------

/** Validates body for creating a new proposal */
const validateCreateProposal = validateBody(createProposalSchema);

/** Validates body for updating an existing proposal */
const validateUpdateProposal = validateBody(updateProposalSchema);

/** Validates body for casting a vote */
const validateCastVote = validateBody(castVoteSchema);

/** Validates query params for listing proposals */
const validateListProposalsQuery = validateQuery(listProposalsQuerySchema);

/** Validates query params for listing votes */
const validateListVotesQuery = validateQuery(listVotesQuerySchema);

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  // Zod schemas (for reuse in tests)
  createProposalSchema,
  updateProposalSchema,
  castVoteSchema,
  listProposalsQuerySchema,
  listVotesQuerySchema,

  // Express middlewares
  validateCreateProposal,
  validateUpdateProposal,
  validateCastVote,
  validateListProposalsQuery,
  validateListVotesQuery,
};
