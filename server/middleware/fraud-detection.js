/**
 * @title Fraud Detection Middleware
 * @description Middleware to monitor and flag suspicious activity
 * @notice Integrates with streaming routes to detect anomalies
 */

const FraudDetectionService = require('../services/fraud-detection-service');
const AlertService = require('../services/alert-service');
const { logger } = require('../utils/logger');

class FraudDetectionMiddleware {
  constructor() {
    this.fraudService = new FraudDetectionService();
    this.alertService = new AlertService();
  }

  /**
   * Monitor streaming operations for fraud
   * @param {Object} options - Configuration options
   * @returns {Function} Express middleware function
   */
  monitorStreamingOperations(options = {}) {
    return async (req, res, next) => {
      try {
        const userId = req.user?.id;
        const operation = req.method + ' ' + req.path;

        if (!userId) {
          return next();
        }

        // Extract transaction data
        const transactionData = {
          amount: req.body?.totalAmount || 0,
          operation: operation,
          timestamp: new Date(),
        };

        // Run comprehensive fraud checks
        const detections = await this.fraudService.runComprehensiveChecks(
          userId,
          transactionData
        );

        // If anomalies detected, create alerts
        if (detections.length > 0) {
          for (const detection of detections) {
            const alert = await this.fraudService.createAlert(
              userId,
              detection.type,
              detection.details.description || 'Suspicious activity detected',
              detection.severity,
              detection.details,
              {
                ipAddress: req.ip,
                userAgent: req.get('user-agent'),
                transactionIds: [req.body?.streamId],
              }
            );

            // Send notifications for high/critical alerts
            if (['high', 'critical'].includes(detection.severity)) {
              const broadcastResult = await this.alertService.broadcastAlert(alert);
              logger.warn('Fraud alert broadcasted', {
                userId,
                alertId: alert._id,
                type: detection.type,
                severity: detection.severity,
                notified: broadcastResult,
              });

              // Mark as notified
              await this.fraudService.markAlertsNotified([alert._id]);
            }
          }

          // For critical alerts, block the operation
          if (detections.some((d) => d.severity === 'critical')) {
            logger.error('Critical fraud detected, blocking operation', {
              userId,
              operation,
              detectionCount: detections.length,
            });

            return res.status(429).json({
              error: 'Suspicious activity detected',
              message:
                'Your account has triggered security alerts. Please contact support if this was unauthorized.',
              alertCount: detections.length,
            });
          }
        }

        next();
      } catch (error) {
        logger.error('Error in fraud detection middleware', { error: error.message });
        // Don't block the request on middleware error
        next();
      }
    };
  }

  /**
   * Rate limit monitoring
   * @param {Object} options - Configuration options
   * @returns {Function} Express middleware function
   */
  monitorRateLimit(options = {}) {
    const userRequests = new Map();
    const windowMs = options.windowMs || 60 * 1000; // 1 minute
    const maxRequests = options.maxRequests || 50;

    return async (req, res, next) => {
      try {
        const userId = req.user?.id;
        if (!userId) return next();

        const now = Date.now();
        const userKey = userId;

        if (!userRequests.has(userKey)) {
          userRequests.set(userKey, []);
        }

        const requests = userRequests.get(userKey);

        // Remove old requests outside window
        const validRequests = requests.filter((time) => now - time < windowMs);
        userRequests.set(userKey, validRequests);

        // Check if exceeds limit
        if (validRequests.length >= maxRequests) {
          const alert = await this.fraudService.createAlert(
            userId,
            'rate_limit_abuse',
            `User exceeded rate limit: ${validRequests.length} requests in ${windowMs / 1000}s`,
            'medium',
            {
              requestCount: validRequests.length,
              limit: maxRequests,
              timeWindow: `${windowMs / 1000}s`,
              endpoint: req.path,
            },
            {
              ipAddress: req.ip,
              userAgent: req.get('user-agent'),
            }
          );

          logger.warn('Rate limit abuse detected', {
            userId,
            requestCount: validRequests.length,
            limit: maxRequests,
          });

          // Notify admins of rate limit abuse
          await this.alertService.broadcastAlert(alert);
          await this.fraudService.markAlertsNotified([alert._id]);
        }

        // Add current request
        validRequests.push(now);

        next();
      } catch (error) {
        logger.error('Error in rate limit monitoring', { error: error.message });
        next();
      }
    };
  }

  /**
   * Post-operation audit
   * Log and check operations after they complete
   * @returns {Function} Express middleware function
   */
  auditOperations() {
    return async (req, res, next) => {
      const userId = req.user?.id;
      const startTime = Date.now();

      // Hook into response
      const originalJson = res.json;
      res.json = function (data) {
        const duration = Date.now() - startTime;

        if (res.statusCode >= 200 && res.statusCode < 400 && userId) {
          // Operation succeeded, check for patterns
          // This is called after successful operations
          logger.debug('Operation completed successfully', {
            userId,
            operation: req.method + ' ' + req.path,
            duration,
            status: res.statusCode,
          });
        }

        return originalJson.call(this, data);
      };

      next();
    };
  }

  /**
   * Get service instances (singleton pattern)
   */
  static getInstance() {
    if (!FraudDetectionMiddleware.instance) {
      FraudDetectionMiddleware.instance = new FraudDetectionMiddleware();
    }
    return FraudDetectionMiddleware.instance;
  }
}

module.exports = FraudDetectionMiddleware;
