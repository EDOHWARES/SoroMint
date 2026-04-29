/**
 * @title Fraud Detection and Anomaly Monitoring Service
 * @description Detects suspicious activity patterns and flags transactions for review
 * @notice Monitors for rapid stream-withdraw-cancel cycles and unusual behavior
 */

const { logger } = require('../utils/logger');
const AnomalyAlert = require('../models/AnomalyAlert');
const Stream = require('../models/Stream');

class FraudDetectionService {
  constructor() {
    // Configuration for anomaly patterns
    this.patterns = {
      rapidStreamCycles: {
        timeWindow: 5 * 60 * 1000, // 5 minutes
        maxCycles: 3, // 3 or more cycles
        description: 'Rapid stream-withdraw-cancel cycles detected',
      },
      excessiveWithdrawals: {
        timeWindow: 10 * 60 * 1000, // 10 minutes
        maxWithdrawals: 10,
        description: 'Excessive withdrawal attempts detected',
      },
      rapidCancelWithdraw: {
        timeWindow: 1 * 60 * 1000, // 1 minute
        maxOperations: 5,
        description: 'Rapid cancel/withdraw operations detected',
      },
      unusualVolume: {
        timeWindow: 1 * 60 * 60 * 1000, // 1 hour
        volumeThreshold: 1000000, // STROOPS
        description: 'Unusual transaction volume detected',
      },
      rateLimitAbuse: {
        timeWindow: 1 * 60 * 1000, // 1 minute
        maxRequests: 50,
        description: 'Rate limit abuse detected',
      },
    };
  }

  /**
   * Check for rapid stream-withdraw-cancel cycles
   * @param {string} userId - User ID
   * @returns {Promise<Object>} Detection result
   */
  async detectRapidStreamCycles(userId) {
    try {
      const { timeWindow, maxCycles } = this.patterns.rapidStreamCycles;
      const now = new Date();
      const windowStart = new Date(now - timeWindow);

      // Get streams created and canceled recently by this user
      const recentStreams = await Stream.aggregate([
        {
          $match: {
            sender: userId,
            createdAt: { $gte: windowStart },
          },
        },
        {
          $group: {
            _id: null,
            count: { $sum: 1 },
            canceledCount: {
              $sum: {
                $cond: [{ $eq: ['$status', 'canceled'] }, 1, 0],
              },
            },
          },
        },
      ]);

      if (
        recentStreams.length > 0 &&
        recentStreams[0].count >= maxCycles &&
        recentStreams[0].canceledCount >= maxCycles
      ) {
        return {
          detected: true,
          severity: 'high',
          details: {
            streamsCreated: recentStreams[0].count,
            streamsCanceled: recentStreams[0].canceledCount,
            timeWindow: `${timeWindow / 1000}s`,
          },
        };
      }

      return { detected: false };
    } catch (error) {
      logger.error('Error detecting rapid stream cycles', { userId, error: error.message });
      return { detected: false, error: error.message };
    }
  }

  /**
   * Check for excessive withdrawals
   * @param {string} userId - User ID
   * @returns {Promise<Object>} Detection result
   */
  async detectExcessiveWithdrawals(userId) {
    try {
      const { timeWindow, maxWithdrawals } = this.patterns.excessiveWithdrawals;
      const now = new Date();
      const windowStart = new Date(now - timeWindow);

      // Count active streams for this user
      const activeStreams = await Stream.countDocuments({
        sender: userId,
        status: 'active',
        createdAt: { $gte: windowStart },
      });

      if (activeStreams >= maxWithdrawals) {
        return {
          detected: true,
          severity: 'medium',
          details: {
            activeStreamCount: activeStreams,
            threshold: maxWithdrawals,
            timeWindow: `${timeWindow / 1000}s`,
          },
        };
      }

      return { detected: false };
    } catch (error) {
      logger.error('Error detecting excessive withdrawals', { userId, error: error.message });
      return { detected: false, error: error.message };
    }
  }

  /**
   * Check for unusual volume in transactions
   * @param {string} userId - User ID
   * @param {number} transactionAmount - Amount in STROOPS
   * @returns {Promise<Object>} Detection result
   */
  async detectUnusualVolume(userId, transactionAmount) {
    try {
      const { timeWindow, volumeThreshold } = this.patterns.unusualVolume;
      const now = new Date();
      const windowStart = new Date(now - timeWindow);

      // Sum all stream amounts for user in time window
      const volumeStats = await Stream.aggregate([
        {
          $match: {
            sender: userId,
            createdAt: { $gte: windowStart },
          },
        },
        {
          $group: {
            _id: null,
            totalVolume: {
              $sum: { $toDouble: '$totalAmount' },
            },
            transactionCount: { $sum: 1 },
          },
        },
      ]);

      const totalVolume =
        volumeStats.length > 0 ? volumeStats[0].totalVolume + transactionAmount : transactionAmount;
      const transactionCount = volumeStats.length > 0 ? volumeStats[0].transactionCount + 1 : 1;

      if (totalVolume > volumeThreshold) {
        return {
          detected: true,
          severity: transactionCount > 5 ? 'high' : 'medium',
          details: {
            totalVolume,
            threshold: volumeThreshold,
            transactionCount,
            timeWindow: `${timeWindow / 60000}m`,
          },
        };
      }

      return { detected: false };
    } catch (error) {
      logger.error('Error detecting unusual volume', { userId, error: error.message });
      return { detected: false, error: error.message };
    }
  }

  /**
   * Create an anomaly alert in the database
   * @param {string} userId - User ID
   * @param {string} alertType - Type of alert
   * @param {string} description - Alert description
   * @param {string} severity - Severity level
   * @param {Object} details - Additional details
   * @param {Object} options - Additional options
   * @returns {Promise<Object>} Created alert
   */
  async createAlert(userId, alertType, description, severity, details, options = {}) {
    try {
      const alert = new AnomalyAlert({
        userId,
        alertType,
        description,
        severity,
        details,
        transactionIds: options.transactionIds || [],
        streamIds: options.streamIds || [],
        metadata: {
          ipAddress: options.ipAddress,
          userAgent: options.userAgent,
          requestCount: options.requestCount,
        },
        notificationChannels: {
          discord: true,
          slack: true,
          email: false,
        },
      });

      await alert.save();
      logger.warn('Anomaly alert created', {
        userId,
        alertType,
        severity,
        alertId: alert._id,
      });

      return alert;
    } catch (error) {
      logger.error('Error creating anomaly alert', { userId, alertType, error: error.message });
      throw error;
    }
  }

  /**
   * Get alerts for a user
   * @param {string} userId - User ID
   * @param {Object} filter - Filter options
   * @returns {Promise<Array>} Alerts
   */
  async getAlerts(userId, filter = {}) {
    try {
      const query = { userId };

      if (filter.status) {
        query.status = filter.status;
      }

      if (filter.severity) {
        query.severity = filter.severity;
      }

      if (filter.alertType) {
        query.alertType = filter.alertType;
      }

      const alerts = await AnomalyAlert.find(query)
        .sort({ createdAt: -1 })
        .limit(filter.limit || 50);

      return alerts;
    } catch (error) {
      logger.error('Error fetching alerts', { userId, error: error.message });
      throw error;
    }
  }

  /**
   * Get open critical alerts
   * @returns {Promise<Array>} Critical alerts
   */
  async getCriticalAlerts() {
    try {
      const alerts = await AnomalyAlert.find({
        status: 'open',
        severity: 'critical',
      })
        .sort({ createdAt: -1 })
        .limit(100);

      return alerts;
    } catch (error) {
      logger.error('Error fetching critical alerts', { error: error.message });
      throw error;
    }
  }

  /**
   * Update alert status
   * @param {string} alertId - Alert ID
   * @param {string} newStatus - New status
   * @param {Object} options - Additional options
   * @returns {Promise<Object>} Updated alert
   */
  async updateAlertStatus(alertId, newStatus, options = {}) {
    try {
      const alert = await AnomalyAlert.findByIdAndUpdate(
        alertId,
        {
          status: newStatus,
          reviewedBy: options.reviewedBy,
          reviewNote: options.reviewNote,
        },
        { new: true }
      );

      logger.info('Alert status updated', {
        alertId,
        status: newStatus,
        reviewedBy: options.reviewedBy,
      });

      return alert;
    } catch (error) {
      logger.error('Error updating alert status', { alertId, error: error.message });
      throw error;
    }
  }

  /**
   * Mark alerts as notified
   * @param {Array<string>} alertIds - Array of alert IDs
   * @returns {Promise<Object>} Update result
   */
  async markAlertsNotified(alertIds) {
    try {
      const result = await AnomalyAlert.updateMany(
        { _id: { $in: alertIds } },
        { isNotified: true }
      );

      logger.info('Alerts marked as notified', { count: result.modifiedCount });
      return result;
    } catch (error) {
      logger.error('Error marking alerts as notified', { error: error.message });
      throw error;
    }
  }

  /**
   * Run comprehensive fraud checks on a user
   * @param {string} userId - User ID
   * @param {Object} transactionData - Transaction data
   * @returns {Promise<Array>} Array of detected anomalies
   */
  async runComprehensiveChecks(userId, transactionData = {}) {
    try {
      const detections = [];

      // Check for rapid cycles
      const cycleDet = await this.detectRapidStreamCycles(userId);
      if (cycleDet.detected) {
        detections.push({
          type: 'rapid_stream_cycles',
          severity: cycleDet.severity,
          details: cycleDet.details,
        });
      }

      // Check for excessive withdrawals
      const withdrawalDet = await this.detectExcessiveWithdrawals(userId);
      if (withdrawalDet.detected) {
        detections.push({
          type: 'excessive_withdrawals',
          severity: withdrawalDet.severity,
          details: withdrawalDet.details,
        });
      }

      // Check for unusual volume
      if (transactionData.amount) {
        const volumeDet = await this.detectUnusualVolume(userId, transactionData.amount);
        if (volumeDet.detected) {
          detections.push({
            type: 'unusual_volume',
            severity: volumeDet.severity,
            details: volumeDet.details,
          });
        }
      }

      return detections;
    } catch (error) {
      logger.error('Error running comprehensive fraud checks', { userId, error: error.message });
      return [];
    }
  }

  /**
   * Get fraud statistics
   * @returns {Promise<Object>} Fraud statistics
   */
  async getStatistics() {
    try {
      const stats = await AnomalyAlert.aggregate([
        {
          $facet: {
            byType: [
              {
                $group: {
                  _id: '$alertType',
                  count: { $sum: 1 },
                },
              },
              {
                $sort: { count: -1 },
              },
            ],
            bySeverity: [
              {
                $group: {
                  _id: '$severity',
                  count: { $sum: 1 },
                },
              },
            ],
            byStatus: [
              {
                $group: {
                  _id: '$status',
                  count: { $sum: 1 },
                },
              },
            ],
            criticalCount: [
              {
                $match: {
                  severity: 'critical',
                  status: 'open',
                },
              },
              {
                $count: 'count',
              },
            ],
            last24Hours: [
              {
                $match: {
                  createdAt: {
                    $gte: new Date(Date.now() - 24 * 60 * 60 * 1000),
                  },
                },
              },
              {
                $count: 'count',
              },
            ],
          },
        },
      ]);

      return {
        byType: stats[0].byType,
        bySeverity: stats[0].bySeverity,
        byStatus: stats[0].byStatus,
        criticalOpenCount: stats[0].criticalCount[0]?.count || 0,
        last24Hours: stats[0].last24Hours[0]?.count || 0,
      };
    } catch (error) {
      logger.error('Error getting fraud statistics', { error: error.message });
      return {};
    }
  }
}

module.exports = FraudDetectionService;
