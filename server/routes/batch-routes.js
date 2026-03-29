const express = require('express');
const { asyncHandler, AppError } = require('../middleware/error-handler');
const { authenticate } = require('../middleware/auth');
const { tokenDeploymentRateLimiter } = require('../middleware/rate-limiter');
const { validateBatch } = require('../validators/token-validator');
const { submitBatchOperations } = require('../services/stellar-service');
const DeploymentAudit = require('../models/DeploymentAudit');
const { logger } = require('../utils/logger');

const router = express.Router();

/**
 * @route POST /api/tokens/batch
 * @description Submit multiple token operations (mint/burn/transfer) as a single
 *              atomic Soroban transaction.
 * @body {Object[]} operations - Array of operations (max 20).
 * @body {string}   sourcePublicKey - Stellar public key of the submitting account.
 * @returns {Object} 200 - txHash, status, and per-operation results.
 * @returns {Object} 207 - Partial failure with per-operation error detail.
 * @security JWT
 */
router.post(
  '/tokens/batch',
  tokenDeploymentRateLimiter,
  authenticate,
  validateBatch,
  asyncHandler(async (req, res) => {
    const { operations, sourcePublicKey } = req.body;
    const userId = req.user._id;

    logger.info('Batch token operation requested', {
      correlationId: req.correlationId,
      operationCount: operations.length,
      sourcePublicKey,
    });

    let batchResult;
    try {
      batchResult = await submitBatchOperations(operations, sourcePublicKey);
    } catch (err) {
      // Record audit for the whole batch failure
      await DeploymentAudit.create({
        userId,
        tokenName: `batch(${operations.length})`,
        status: 'FAIL',
        errorMessage: err.message,
      });
      throw err;
    }

    // Audit each operation individually for traceability
    await Promise.all(
      batchResult.results.map((r) =>
        DeploymentAudit.create({
          userId,
          tokenName: `batch:${r.type}`,
          contractId: r.contractId,
          status: r.status === 'SUBMITTED' ? 'SUCCESS' : 'FAIL',
          errorMessage: r.error || undefined,
        })
      )
    );

    const hasFailures = batchResult.results.some((r) => r.status === 'FAILED');
    const httpStatus = !batchResult.success ? 422 : hasFailures ? 207 : 200;

    res.status(httpStatus).json({
      success: batchResult.success,
      txHash: batchResult.txHash || null,
      status: batchResult.status,
      results: batchResult.results,
    });
  })
);

module.exports = router;
