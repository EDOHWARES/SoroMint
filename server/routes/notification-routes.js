const express = require('express');
const NotificationPreferences = require('../models/NotificationPreferences');
const { authenticate } = require('../middleware/auth');
const { asyncHandler, AppError } = require('../middleware/error-handler');
const { logger } = require('../utils/logger');
const { getEnv } = require('../config/env-config');

const router = express.Router();

router.get(
  '/notifications/preferences',
  authenticate,
  asyncHandler(async (req, res) => {
    const prefs = await NotificationPreferences.findByUserId(req.user._id);

    res.json({
      success: true,
      data: {
        email: prefs.email,
        webPush: {
          enabled: prefs.webPush.enabled,
          subscribed: !!(prefs.webPush.subscription && prefs.webPush.subscription.endpoint),
        },
        events: prefs.events,
      },
    });
  }),
);

router.put(
  '/notifications/preferences',
  authenticate,
  asyncHandler(async (req, res) => {
    const { email, webPush, events } = req.body;

    const prefs = await NotificationPreferences.findByUserId(req.user._id);

    if (email) {
      if (typeof email.enabled === 'boolean') prefs.email.enabled = email.enabled;
      if (email.address) prefs.email.address = email.address;
    }

    if (webPush) {
      if (typeof webPush.enabled === 'boolean') prefs.webPush.enabled = webPush.enabled;
      if (webPush.subscription) {
        prefs.webPush.subscription = webPush.subscription;
      }
    }

    if (events) {
      if (typeof events.tokenMinted === 'boolean') prefs.events.tokenMinted = events.tokenMinted;
      if (typeof events.transactionConfirmed === 'boolean') prefs.events.transactionConfirmed = events.transactionConfirmed;
      if (typeof events.deploymentFailed === 'boolean') prefs.events.deploymentFailed = events.deploymentFailed;
    }

    await prefs.save();

    logger.info('Notification preferences updated', {
      correlationId: req.correlationId,
      userId: req.user._id,
    });

    res.json({
      success: true,
      message: 'Notification preferences updated',
      data: {
        email: prefs.email,
        webPush: {
          enabled: prefs.webPush.enabled,
          subscribed: !!(prefs.webPush.subscription && prefs.webPush.subscription.endpoint),
        },
        events: prefs.events,
      },
    });
  }),
);

router.get(
  '/notifications/vapid-public-key',
  asyncHandler(async (req, res) => {
    const env = getEnv();
    res.json({
      success: true,
      data: {
        publicKey: env.VAPID_PUBLIC_KEY || '',
      },
    });
  }),
);

module.exports = router;
