const express = require('express');
const { asyncHandler } = require('../middleware/error-handler');
const { authenticate } = require('../middleware/auth');
const referralService = require('../services/referral-service');
const { logger } = require('../utils/logger');

const router = express.Router();

/**
 * @route GET /api/referrals/stats
 * @description Get the current user's referral statistics
 */
router.get(
  '/stats',
  authenticate,
  asyncHandler(async (req, res) => {
    const userId = req.user._id;
    
    logger.info('Fetching referral stats', { userId, publicKey: req.user.publicKey });
    
    const stats = await referralService.getReferralStats(userId);
    
    res.json({
      success: true,
      data: {
        ...stats,
        referralCode: req.user.referralCode
      }
    });
  })
);

/**
 * @route GET /api/referrals/history
 * @description Get the current user's referral reward history
 */
router.get(
  '/history',
  authenticate,
  asyncHandler(async (req, res) => {
    const userId = req.user._id;
    
    logger.info('Fetching referral history', { userId, publicKey: req.user.publicKey });
    
    const history = await referralService.getReferralHistory(userId);
    
    res.json({
      success: true,
      data: history
    });
  })
);

module.exports = router;
