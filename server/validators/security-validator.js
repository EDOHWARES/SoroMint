'use strict';

const { z } = require('zod');
const { AppError } = require('../middleware/error-handler');
const { logger } = require('../utils/logger');

// ---------------------------------------------------------------------------
// Reusable field schemas
// ---------------------------------------------------------------------------

/**
 * Valid base64 character set (standard + padding).
 * Allows standard base64 (A-Za-z0-9+/) and URL-safe base64 (A-Za-z0-9-_)
 * with optional padding.
 */
const base64Regex = /^[A-Za-z0-9+/\-_]+=*$/;

/**
 * MongoDB ObjectId: 24 hexadecimal characters.
 */
const mongoObjectIdRegex = /^[0-9a-fA-F]{24}$/;

/**
 * UUID v4 pattern (used as scanId).
 */
const uuidRegex =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ---------------------------------------------------------------------------
// Scan request schema  (POST /api/security/scan)
// ---------------------------------------------------------------------------

/**
 * @notice Validates the JSON body submitted to POST /api/security/scan.
 *
 * @field wasm          {string}  Required. Base64-encoded WASM binary.
 *                                Max length 7 000 000 chars ≈ 5.2 MB decoded.
 *                                Must pass the base64 character-set check.
 * @field contractName  {string}  Optional. Human label for the scanned contract.
 * @field notes         {string}  Optional. Free-text caller notes.
 */
const scanRequestSchema = z.object({
  wasm: z
    .string({
      required_error: 'wasm is required',
      invalid_type_error: 'wasm must be a base64-encoded string',
    })
    .trim()
    .min(
      12,
      'wasm must be at least 12 characters (smallest valid WASM in base64)'
    )
    .max(
      7_000_000,
      'wasm exceeds the maximum allowed length (≈5 MB decoded). ' +
        'Use wasm-opt to reduce the binary size before uploading.'
    )
    .refine((val) => base64Regex.test(val), {
      message:
        'wasm must be a valid base64-encoded string. ' +
        'Only characters A-Z, a-z, 0-9, +, /, -, _ and = (padding) are allowed.',
    }),

  contractName: z
    .string()
    .trim()
    .min(1, 'contractName must not be empty if provided')
    .max(100, 'contractName must not exceed 100 characters')
    .optional()
    .default(null)
    .transform((v) => (v === undefined ? null : v)),

  notes: z
    .string()
    .trim()
    .min(1, 'notes must not be empty if provided')
    .max(500, 'notes must not exceed 500 characters')
    .optional()
    .default(null)
    .transform((v) => (v === undefined ? null : v)),
});

// ---------------------------------------------------------------------------
// Scan list query schema  (GET /api/security/scans)
// ---------------------------------------------------------------------------

/**
 * @notice Validates the query parameters for GET /api/security/scans.
 *
 * @field page    {number}  Page number, min 1. Default 1.
 * @field limit   {number}  Results per page, 1–100. Default 20.
 * @field status  {string}  Optional filter by scan status.
 */
const scanListQuerySchema = z.object({
  page: z.coerce
    .number({
      invalid_type_error: 'page must be a number',
    })
    .int('page must be an integer')
    .min(1, 'page must be at least 1')
    .optional()
    .default(1),

  limit: z.coerce
    .number({
      invalid_type_error: 'limit must be a number',
    })
    .int('limit must be an integer')
    .min(1, 'limit must be at least 1')
    .max(100, 'limit must not exceed 100')
    .optional()
    .default(20),

  status: z
    .enum(['clean', 'passed', 'warning', 'failed', 'error'], {
      message:
        "status must be one of: 'clean', 'passed', 'warning', 'failed', 'error'",
    })
    .optional(),
});

// ---------------------------------------------------------------------------
// Pre-deployment check schema  (used by POST /api/tokens gate)
// ---------------------------------------------------------------------------

/**
 * @notice Validates the optional `scanId` field added to the token-deployment
 *         request body when REQUIRE_SECURITY_SCAN=true is set.
 *
 * @field scanId  {string}  Optional. Must be either a UUID v4 (scanId format
 *                          used by ScanResult documents) or a 24-char hex
 *                          MongoDB ObjectId.  Accepts both so the client can
 *                          reference scans by either identifier.
 */
const preDeploymentCheckSchema = z.object({
  scanId: z
    .string()
    .trim()
    .refine((val) => uuidRegex.test(val) || mongoObjectIdRegex.test(val), {
      message:
        'scanId must be a valid UUID (e.g. "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx") ' +
        'or a 24-character hex MongoDB ObjectId.',
    })
    .optional(),
});

// ---------------------------------------------------------------------------
// Middleware factories
// ---------------------------------------------------------------------------

/**
 * @notice Builds an Express middleware that validates req.body against a Zod
 *         schema, replaces req.body with the coerced/defaulted data on
 *         success, or calls next(AppError) on failure.
 *
 * @param  {z.ZodSchema} schema
 * @returns {Function}  Express middleware
 */
const validateBody = (schema) => (req, res, next) => {
  const result = schema.safeParse(req.body);

  if (!result.success) {
    const message = result.error.errors
      .map((e) => {
        const path = e.path.join('.') || 'body';
        return `${path}: ${e.message}`;
      })
      .join('; ');

    logger.warn('Security request body validation failed', {
      correlationId: req.correlationId,
      errors: result.error.errors,
      method: req.method,
      path: req.path,
    });

    return next(new AppError(message, 400, 'VALIDATION_ERROR'));
  }

  req.body = result.data;
  return next();
};

/**
 * @notice Builds an Express middleware that validates req.query against a Zod
 *         schema, merges coerced/defaulted values back into req.query on
 *         success, or calls next(AppError) on failure.
 *
 * @param  {z.ZodSchema} schema
 * @returns {Function}  Express middleware
 */
const validateQuery = (schema) => (req, res, next) => {
  const result = schema.safeParse(req.query);

  if (!result.success) {
    const message = result.error.errors
      .map((e) => {
        const path = e.path.join('.') || 'query';
        return `${path}: ${e.message}`;
      })
      .join('; ');

    logger.warn('Security request query validation failed', {
      correlationId: req.correlationId,
      errors: result.error.errors,
      method: req.method,
      path: req.path,
    });

    return next(new AppError(message, 400, 'VALIDATION_ERROR'));
  }

  req.query = { ...req.query, ...result.data };
  return next();
};

// ---------------------------------------------------------------------------
// Named middleware exports
// ---------------------------------------------------------------------------

/**
 * Validates req.body for POST /api/security/scan.
 * Ensures `wasm` is a non-empty, correctly-formatted base64 string.
 */
const validateScanRequest = validateBody(scanRequestSchema);

/**
 * Validates req.query for GET /api/security/scans.
 * Coerces page/limit and validates optional status filter.
 */
const validateListScansQuery = validateQuery(scanListQuerySchema);

/**
 * Validates the optional `scanId` field in a token-deployment request body.
 * Designed to be composed with the existing token validator, not replace it.
 */
const validatePreDeploymentCheck = validateBody(preDeploymentCheckSchema);

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  // Zod schemas (re-exported for use in tests and composed validators)
  scanRequestSchema,
  scanListQuerySchema,
  preDeploymentCheckSchema,

  // Express middleware
  validateScanRequest,
  validateListScansQuery,
  validatePreDeploymentCheck,
};
