const express = require('express');
const User = require('../models/User');
const Token = require('../models/Token');
const Stream = require('../models/Stream');
const SystemConfig = require('../models/SystemConfig');
const TVLAnalyticsService = require('../services/tvl-analytics-service');
const { authenticate, authorize } = require('../middleware/auth');
const { asyncHandler, AppError } = require('../middleware/error-handler');

const router = express.Router();
const tvlAnalyticsService = new TVLAnalyticsService();

const PLATFORM_CONFIG_KEY = 'platform';

const getMaintenanceConfig = async () => {
  const config = await SystemConfig.findOne({ key: PLATFORM_CONFIG_KEY }).lean();

  if (!config) {
    return {
      maintenanceMode: false,
      updatedBy: null,
      updatedAt: null,
    };
  }

  return {
    maintenanceMode: config.maintenanceMode,
    updatedBy: config.updatedBy || null,
    updatedAt: config.updatedAt || null,
  };
};

router.use('/admin', authenticate, authorize('admin'));

router.get(
  '/admin/tvl',
  asyncHandler(async (_req, res) => {
    const tvl = await tvlAnalyticsService.calculateTVL();

    res.json({
      success: true,
      data: tvl,
    });
  })
);

router.get(
  '/admin/metrics',
  asyncHandler(async (_req, res) => {
    const [
      tvl,
      totalUsers,
      activeUsers,
      suspendedUsers,
      totalTokens,
      totalStreams,
      activeStreams,
      maintenance,
    ] = await Promise.all([
      tvlAnalyticsService.calculateTVL(),
      User.countDocuments({}),
      User.countDocuments({ status: 'active' }),
      User.countDocuments({ status: 'suspended' }),
      Token.countDocuments({}),
      Stream.countDocuments({}),
      Stream.countDocuments({ status: 'active' }),
      getMaintenanceConfig(),
    ]);

    res.json({
      success: true,
      data: {
        timestamp: new Date().toISOString(),
        maintenanceMode: maintenance.maintenanceMode,
        tvl: {
          totalValueLocked: tvl.totalValueLocked,
          totalValueLockedFormatted: tvl.totalValueLockedFormatted,
          activeStreamCount: tvl.activeStreamCount,
        },
        users: {
          total: totalUsers,
          active: activeUsers,
          suspended: suspendedUsers,
        },
        tokens: {
          total: totalTokens,
        },
        streams: {
          total: totalStreams,
          active: activeStreams,
        },
      },
    });
  })
);

router.get(
  '/admin/maintenance',
  asyncHandler(async (_req, res) => {
    const config = await getMaintenanceConfig();

    res.json({
      success: true,
      data: config,
    });
  })
);

router.patch(
  '/admin/maintenance',
  asyncHandler(async (req, res) => {
    const { enabled } = req.body;

    if (typeof enabled !== 'boolean') {
      throw new AppError(
        'enabled must be a boolean value',
        400,
        'VALIDATION_ERROR'
      );
    }

    const config = await SystemConfig.findOneAndUpdate(
      { key: PLATFORM_CONFIG_KEY },
      {
        key: PLATFORM_CONFIG_KEY,
        maintenanceMode: enabled,
        updatedBy: req.user._id,
      },
      {
        new: true,
        upsert: true,
        runValidators: true,
        setDefaultsOnInsert: true,
      }
    );

    res.json({
      success: true,
      data: {
        maintenanceMode: config.maintenanceMode,
        updatedBy: config.updatedBy,
        updatedAt: config.updatedAt,
      },
    });
  })
);

router.patch(
  '/admin/users/:userId/ban',
  asyncHandler(async (req, res) => {
    const { userId } = req.params;

    if (String(req.user._id) === String(userId)) {
      throw new AppError('You cannot ban your own account', 400, 'SELF_BAN');
    }

    const targetUser = await User.findById(userId);

    if (!targetUser) {
      throw new AppError('User not found', 404, 'USER_NOT_FOUND');
    }

    if (targetUser.status === 'deleted') {
      throw new AppError(
        'Deleted users cannot be banned',
        400,
        'INVALID_USER_STATUS'
      );
    }

    if (targetUser.status !== 'suspended') {
      targetUser.status = 'suspended';
      await targetUser.save();
    }

    res.json({
      success: true,
      data: {
        id: targetUser._id,
        status: targetUser.status,
      },
    });
  })
);

router.patch(
  '/admin/users/:userId/unban',
  asyncHandler(async (req, res) => {
    const { userId } = req.params;

    const targetUser = await User.findById(userId);

    if (!targetUser) {
      throw new AppError('User not found', 404, 'USER_NOT_FOUND');
    }

    if (targetUser.status === 'deleted') {
      throw new AppError(
        'Deleted users cannot be unbanned',
        400,
        'INVALID_USER_STATUS'
      );
    }

    if (targetUser.status !== 'active') {
      targetUser.status = 'active';
      await targetUser.save();
    }

    res.json({
      success: true,
      data: {
        id: targetUser._id,
        status: targetUser.status,
      },
    });
  })
);

module.exports = router;
