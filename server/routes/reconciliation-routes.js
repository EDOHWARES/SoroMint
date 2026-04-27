/**
 * Reconciliation Admin Routes
 * Allows admins to manually trigger a reconciliation pass and view results.
 */

const express = require('express');
const { authenticate } = require('../middleware/auth');
const { asyncHandler, AppError } = require('../middleware/error-handler');
const { runReconciliation } = require('../services/reconciliation-service');
const { logger } = require('../utils/logger');

const router = express.Router();

const requireAdmin = (req, res, next) => {
  if (!req.user || req.user.role !== 'admin') {
    return next(new AppError('Admin access required', 403, 'FORBIDDEN'));
  }
  next();
};

/**
 * @route POST /api/reconciliation/run
 * @desc  Manually trigger a reconciliation pass (admin only)
 * @access Admin
 */
router.post(
  '/run',
  authenticate,
  requireAdmin,
  asyncHandler(async (req, res) => {
    logger.info('[Reconciliation] Manual run triggered', {
      correlationId: req.correlationId,
      admin: req.user.publicKey,
    });

    const summary = await runReconciliation();
    res.json({ success: true, summary });
  })
);

module.exports = router;
