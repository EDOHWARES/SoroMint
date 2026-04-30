const express = require('express');
const PlatformFeeService = require('../services/platform-fee-service');
const { body, param, validationResult } = require('express-validator');

const router = express.Router();

const validate = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }
  next();
};

// Middleware to check if user is admin
const requireAdmin = (req, res, next) => {
  // This is a placeholder - implement proper admin authentication
  // You might check against a user role, API key, or other auth mechanism
  const isAdmin = req.headers['x-admin-key'] === process.env.ADMIN_API_KEY;
  if (!isAdmin) {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
};

// Get collected fees statistics
router.get('/fees/stats', requireAdmin, async (req, res, next) => {
  try {
    const feeService = new PlatformFeeService();
    const stats = await feeService.getFeeStatistics();
    
    res.json({ success: true, stats });
  } catch (error) {
    next(error);
  }
});

// Get collected fees with optional filtering
router.get('/fees', 
  requireAdmin,
  [
    param('tokenAddress').optional().isString(),
    param('status').optional().isIn(['collected', 'withdrawn', 'pending']),
    validate,
  ],
  async (req, res, next) => {
    try {
      const { tokenAddress, status } = req.query;
      const feeService = new PlatformFeeService();
      const result = await feeService.getCollectedFees(tokenAddress, status);
      
      res.json({ success: true, ...result });
    } catch (error) {
      next(error);
    }
  }
);

// Withdraw collected fees
router.post('/fees/withdraw',
  requireAdmin,
  [
    body('tokenAddress').isString().notEmpty(),
    body('amount').optional().isString().notEmpty(),
    body('adminAddress').isString().notEmpty(),
    validate,
  ],
  async (req, res, next) => {
    try {
      const { tokenAddress, amount, adminAddress } = req.body;
      const feeService = new PlatformFeeService();
      
      // Get fees to withdraw (all or specific amount)
      const feesToWithdraw = await feeService.withdrawFees(adminAddress, tokenAddress, amount);
      
      if (feesToWithdraw.length === 0) {
        return res.status(400).json({ error: 'No fees available for withdrawal' });
      }

      // Calculate total withdrawal amount
      const totalAmount = feesToWithdraw.reduce((sum, fee) => {
        return sum + BigInt(fee.feeAmount);
      }, 0n);

      // Here you would implement the actual token transfer logic
      // For now, we'll mark them as withdrawn
      const feeIds = feesToWithdraw.map(fee => fee._id);
      const mockTxHash = 'withdraw_' + Date.now();
      
      await feeService.markFeesAsWithdrawn(feeIds, mockTxHash, adminAddress);

      res.json({
        success: true,
        withdrawnAmount: totalAmount.toString(),
        feeCount: feesToWithdraw.length,
        txHash: mockTxHash,
        fees: feesToWithdraw.map(fee => ({
          id: fee._id,
          amount: fee.feeAmount,
          streamId: fee.streamId
        }))
      });
    } catch (error) {
      next(error);
    }
  }
);

// Get fee withdrawal history
router.get('/fees/withdrawals', requireAdmin, async (req, res, next) => {
  try {
    const PlatformFee = require('../models/PlatformFee');
    const withdrawals = await PlatformFee.find({ status: 'withdrawn' })
      .sort({ withdrawnAt: -1 })
      .select('feeAmount withdrawnTxHash withdrawnAt withdrawnBy tokenAddress streamId');

    res.json({ success: true, withdrawals });
  } catch (error) {
    next(error);
  }
});

// Get all fee configurations
router.get('/fee-configs', requireAdmin, async (req, res, next) => {
  try {
    const PlatformFeeConfig = require('../models/PlatformFeeConfig');
    const configs = await PlatformFeeConfig.find().sort({ createdAt: -1 });
    
    res.json({ success: true, configs });
  } catch (error) {
    next(error);
  }
});

// Create or update fee configuration
router.post('/fee-configs',
  requireAdmin,
  [
    body('tokenAddress').isString().notEmpty(),
    body('feePercentage').isFloat({ min: 0, max: 100 }),
    body('updatedBy').isString().notEmpty(),
    body('description').optional().isString(),
    body('minFeeAmount').optional().isString(),
    body('maxFeeAmount').optional().isString(),
    validate,
  ],
  async (req, res, next) => {
    try {
      const { tokenAddress, feePercentage, updatedBy, description, minFeeAmount, maxFeeAmount } = req.body;
      
      const PlatformFeeConfig = require('../models/PlatformFeeConfig');
      
      const config = await PlatformFeeConfig.findOneAndUpdate(
        { tokenAddress },
        {
          feePercentage,
          updatedBy,
          description,
          minFeeAmount: minFeeAmount || '0',
          maxFeeAmount,
          isActive: true,
        },
        { upsert: true, new: true }
      );

      res.json({ success: true, config });
    } catch (error) {
      next(error);
    }
  }
);

// Toggle fee configuration active status
router.patch('/fee-configs/:tokenAddress/toggle',
  requireAdmin,
  [
    param('tokenAddress').isString().notEmpty(),
    body('isActive').isBoolean(),
    body('updatedBy').isString().notEmpty(),
    validate,
  ],
  async (req, res, next) => {
    try {
      const { tokenAddress } = req.params;
      const { isActive, updatedBy } = req.body;
      
      const PlatformFeeConfig = require('../models/PlatformFeeConfig');
      
      const config = await PlatformFeeConfig.findOneAndUpdate(
        { tokenAddress },
        { isActive, updatedBy },
        { new: true }
      );

      if (!config) {
        return res.status(404).json({ error: 'Fee configuration not found' });
      }

      res.json({ success: true, config });
    } catch (error) {
      next(error);
    }
  }
);

// Delete fee configuration
router.delete('/fee-configs/:tokenAddress',
  requireAdmin,
  [param('tokenAddress').isString().notEmpty(), validate],
  async (req, res, next) => {
    try {
      const { tokenAddress } = req.params;
      
      const PlatformFeeConfig = require('../models/PlatformFeeConfig');
      
      const result = await PlatformFeeConfig.deleteOne({ tokenAddress });

      if (result.deletedCount === 0) {
        return res.status(404).json({ error: 'Fee configuration not found' });
      }

      res.json({ success: true, message: 'Fee configuration deleted' });
    } catch (error) {
      next(error);
    }
  }
);

module.exports = router;
