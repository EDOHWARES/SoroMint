/**
 * Key Vault Admin Routes
 * Exposes audit log and public key info for platform keys.
 * All routes require admin role — private keys are NEVER returned.
 */

const express = require('express');
const { authenticate } = require('../middleware/auth');
const { asyncHandler, AppError } = require('../middleware/error-handler');
const { getAccessLog, getPublicKeyForPurpose, KEY_SLOTS } = require('../services/key-vault-service');
const { logger } = require('../utils/logger');

const router = express.Router();

// Middleware: admin-only guard
const requireAdmin = (req, res, next) => {
  if (!req.user || req.user.role !== 'admin') {
    return next(new AppError('Admin access required', 403, 'FORBIDDEN'));
  }
  next();
};

/**
 * @route GET /api/key-vault/audit-log
 * @desc  Return the in-memory key access audit log (admin only)
 * @access Admin
 */
router.get(
  '/audit-log',
  authenticate,
  requireAdmin,
  asyncHandler(async (req, res) => {
    const log = getAccessLog();
    logger.info('[KeyVault] Audit log accessed', {
      correlationId: req.correlationId,
      admin: req.user.publicKey,
      entries: log.length,
    });
    res.json({ success: true, count: log.length, log });
  })
);

/**
 * @route GET /api/key-vault/public-keys
 * @desc  Return the public keys for all platform key slots (admin only)
 * @access Admin
 */
router.get(
  '/public-keys',
  authenticate,
  requireAdmin,
  asyncHandler(async (req, res) => {
    const keys = {};
    for (const purpose of Object.keys(KEY_SLOTS)) {
      try {
        keys[purpose] = getPublicKeyForPurpose(purpose);
      } catch (err) {
        keys[purpose] = `ERROR: ${err.message}`;
      }
    }
    res.json({ success: true, keys });
  })
);

module.exports = router;
