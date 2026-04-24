const express = require('express');
const { authenticate } = require('../middleware/auth');
const { asyncHandler, AppError } = require('../middleware/error-handler');
const { logger } = require('../utils/logger');
const sponsorshipService = require('../services/sponsorship-service');

const createSponsorshipRouter = ({
  applyForSponsorship = sponsorshipService.applyForSponsorship,
  getSponsorshipStatus = sponsorshipService.getSponsorshipStatus,
  executeSponsoredTransaction = sponsorshipService.executeSponsoredTransaction,
} = {}) => {
  const router = express.Router();

  router.post('/apply', authenticate, asyncHandler(async (req, res) => {
    const requestedBudgetStroops = req.body?.requestedBudgetStroops;

    if (
      requestedBudgetStroops !== undefined &&
      (!Number.isInteger(requestedBudgetStroops) || requestedBudgetStroops < 0)
    ) {
      throw new AppError('requestedBudgetStroops must be a non-negative integer', 400, 'INVALID_PARAMETER');
    }

    logger.info('Sponsorship application requested', {
      correlationId: req.correlationId,
      publicKey: req.user.publicKey,
      requestedBudgetStroops: requestedBudgetStroops ?? null,
    });

    const status = await applyForSponsorship(req.user, { requestedBudgetStroops });

    res.json({
      success: true,
      data: status,
    });
  }));

  router.get('/status', authenticate, asyncHandler(async (req, res) => {
    const status = await getSponsorshipStatus(req.user);

    res.json({
      success: true,
      data: status,
    });
  }));

  router.post('/execute', authenticate, asyncHandler(async (req, res) => {
    const { transactionXdr, feeStroops } = req.body || {};

    if (!transactionXdr || typeof transactionXdr !== 'string' || !transactionXdr.trim()) {
      throw new AppError('transactionXdr is required', 400, 'VALIDATION_ERROR');
    }

    if (feeStroops !== undefined && (!Number.isInteger(feeStroops) || feeStroops <= 0)) {
      throw new AppError('feeStroops must be a positive integer', 400, 'INVALID_PARAMETER');
    }

    logger.info('Sponsored execution requested', {
      correlationId: req.correlationId,
      publicKey: req.user.publicKey,
      feeStroops: feeStroops ?? null,
    });

    const result = await executeSponsoredTransaction(req.user, {
      transactionXdr,
      feeStroops,
    });

    res.status(202).json({
      success: true,
      data: result,
    });
  }));

  return router;
};

module.exports = createSponsorshipRouter();
module.exports.createSponsorshipRouter = createSponsorshipRouter;
