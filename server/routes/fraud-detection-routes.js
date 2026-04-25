/**
 * @title Fraud Detection Routes
 * @description API endpoints for fraud detection and anomaly monitoring
 * @notice Routes for viewing alerts and managing review status
 */

const express = require('express');
const { param, query, body, validationResult } = require('express-validator');
const FraudDetectionService = require('../services/fraud-detection-service');
const AlertService = require('../services/alert-service');
const AnomalyAlert = require('../models/AnomalyAlert');
const { logger } = require('../utils/logger');

const router = express.Router();

const validate = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }
  next();
};

/**
 * Get user's anomaly alerts
 * GET /api/fraud-detection/alerts
 */
router.get(
  '/alerts',
  [
    query('status').optional().isIn(['open', 'reviewing', 'resolved', 'false_alarm']),
    query('severity').optional().isIn(['low', 'medium', 'high', 'critical']),
    query('alertType').optional().isString(),
    query('limit').optional().isInt({ min: 1, max: 100 }),
    validate,
  ],
  async (req, res, next) => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      const fraudService = new FraudDetectionService();
      const filter = {
        status: req.query.status,
        severity: req.query.severity,
        alertType: req.query.alertType,
        limit: req.query.limit || 50,
      };

      const alerts = await fraudService.getAlerts(userId, filter);

      res.json({
        success: true,
        count: alerts.length,
        alerts,
      });
    } catch (error) {
      logger.error('Error fetching alerts', { error: error.message });
      next(error);
    }
  }
);

/**
 * Get alert details
 * GET /api/fraud-detection/alerts/:alertId
 */
router.get(
  '/alerts/:alertId',
  [param('alertId').isMongoId()],
  async (req, res, next) => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      const alert = await AnomalyAlert.findById(req.params.alertId);
      if (!alert) {
        return res.status(404).json({ error: 'Alert not found' });
      }

      // Verify ownership
      if (alert.userId !== userId) {
        return res.status(403).json({ error: 'Forbidden' });
      }

      res.json({
        success: true,
        alert,
      });
    } catch (error) {
      logger.error('Error fetching alert details', { error: error.message });
      next(error);
    }
  }
);

/**
 * Update alert status
 * PATCH /api/fraud-detection/alerts/:alertId/status
 */
router.patch(
  '/alerts/:alertId/status',
  [
    param('alertId').isMongoId(),
    body('status').isIn(['open', 'reviewing', 'resolved', 'false_alarm']),
    body('reviewNote').optional().isString(),
    validate,
  ],
  async (req, res, next) => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      // Verify admin or owner
      const isAdmin = req.user?.role === 'admin';

      const alert = await AnomalyAlert.findById(req.params.alertId);
      if (!alert) {
        return res.status(404).json({ error: 'Alert not found' });
      }

      if (!isAdmin && alert.userId !== userId) {
        return res.status(403).json({ error: 'Forbidden' });
      }

      const fraudService = new FraudDetectionService();
      const updatedAlert = await fraudService.updateAlertStatus(req.params.alertId, req.body.status, {
        reviewedBy: userId,
        reviewNote: req.body.reviewNote,
      });

      res.json({
        success: true,
        alert: updatedAlert,
      });
    } catch (error) {
      logger.error('Error updating alert status', { error: error.message });
      next(error);
    }
  }
);

/**
 * Get fraud detection statistics
 * GET /api/fraud-detection/statistics
 * Admin only
 */
router.get('/statistics', async (req, res, next) => {
  try {
    const isAdmin = req.user?.role === 'admin';
    if (!isAdmin) {
      return res.status(403).json({ error: 'Admin access required' });
    }

    const fraudService = new FraudDetectionService();
    const stats = await fraudService.getStatistics();

    res.json({
      success: true,
      statistics: stats,
    });
  } catch (error) {
    logger.error('Error fetching statistics', { error: error.message });
    next(error);
  }
});

/**
 * Get critical alerts
 * GET /api/fraud-detection/critical-alerts
 * Admin only
 */
router.get('/critical-alerts', async (req, res, next) => {
  try {
    const isAdmin = req.user?.role === 'admin';
    if (!isAdmin) {
      return res.status(403).json({ error: 'Admin access required' });
    }

    const fraudService = new FraudDetectionService();
    const alerts = await fraudService.getCriticalAlerts();

    res.json({
      success: true,
      count: alerts.length,
      alerts,
    });
  } catch (error) {
    logger.error('Error fetching critical alerts', { error: error.message });
    next(error);
  }
});

/**
 * Test alert notification
 * POST /api/fraud-detection/test-alert
 * Admin only
 */
router.post(
  '/test-alert',
  [
    body('severity').isIn(['low', 'medium', 'high', 'critical']),
    body('alertType').optional().isString(),
    validate,
  ],
  async (req, res, next) => {
    try {
      const isAdmin = req.user?.role === 'admin';
      if (!isAdmin) {
        return res.status(403).json({ error: 'Admin access required' });
      }

      const testAlert = {
        _id: 'test-' + Date.now(),
        userId: 'test-user',
        severity: req.body.severity,
        alertType: req.body.alertType || 'suspicious_pattern',
        description: 'This is a test alert from fraud detection system',
        details: { test: true, timestamp: new Date() },
        notificationChannels: {
          discord: true,
          slack: true,
        },
        createdAt: new Date(),
      };

      const alertService = new AlertService();
      const results = await alertService.broadcastAlert(testAlert);

      res.json({
        success: true,
        message: 'Test alert sent',
        results,
      });
    } catch (error) {
      logger.error('Error sending test alert', { error: error.message });
      next(error);
    }
  }
);

/**
 * Get open high-severity alerts (for dashboard)
 * GET /api/fraud-detection/open-alerts
 */
router.get('/open-alerts', async (req, res, next) => {
  try {
    const isAdmin = req.user?.role === 'admin';
    if (!isAdmin) {
      return res.status(403).json({ error: 'Admin access required' });
    }

    const alerts = await AnomalyAlert.find({
      status: { $in: ['open', 'reviewing'] },
      severity: { $in: ['high', 'critical'] },
    })
      .sort({ severity: -1, createdAt: -1 })
      .limit(100);

    res.json({
      success: true,
      count: alerts.length,
      alerts,
    });
  } catch (error) {
    logger.error('Error fetching open alerts', { error: error.message });
    next(error);
  }
});

module.exports = router;
