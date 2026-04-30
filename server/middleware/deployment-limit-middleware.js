const BillingService = require('../services/billing-service');
const logger = require('winston');

// Check deployment limits and track usage

/**
 * Middleware to check deployment limits
 * Should be placed before deployment route handlers
 */
const checkDeploymentLimit = async (req, res, next) => {
  try {
    if (!req.user || !req.user.id) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    // Get current deployment usage
    const usage = await BillingService.getDeploymentUsage(req.user.id);

    // Check if hard limit is exceeded
    if (usage && usage.isLimitExceeded) {
      return res.status(403).json({
        error: 'Deployment limit exceeded',
        message: `You have reached your monthly deployment limit of ${usage.maxDeployments}`,
        remaining: 0,
        used: usage.deploymentsCount,
        limit: usage.maxDeployments,
      });
    }

    // Check if at hard limit
    if (usage && usage.maxDeployments && usage.deploymentsCount >= usage.maxDeployments) {
      return res.status(403).json({
        error: 'Deployment limit reached',
        message: `You have reached your monthly deployment limit of ${usage.maxDeployments}`,
        remaining: 0,
        used: usage.deploymentsCount,
        limit: usage.maxDeployments,
      });
    }

    // Attach usage info to request for later use
    req.deploymentUsage = usage;

    // Add warning header if approaching soft limit
    if (usage && usage.maxDeployments) {
      const softLimitThreshold = usage.maxDeployments * 0.8; // 80% default
      if (usage.deploymentsCount >= softLimitThreshold) {
        const remaining = usage.maxDeployments - usage.deploymentsCount;
        res.setHeader('X-Deployment-Warning', 'true');
        res.setHeader('X-Deployments-Remaining', remaining);
        logger.warn(
          `User ${req.user.id} approaching deployment limit: ${usage.deploymentsCount}/${usage.maxDeployments}`
        );
      }
    }

    next();
  } catch (error) {
    logger.error('Error checking deployment limit:', error);
    res.status(500).json({ error: 'Failed to check deployment limit' });
  }
};

/**
 * Middleware to track deployment after successful deployment
 */
const trackDeployment = async (req, res, next) => {
  try {
    if (!req.user || !req.user.id) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    // Store original res.json method
    const originalJson = res.json.bind(res);

    // Override res.json to track deployment on success
    res.json = function (data) {
      // Only track if response is successful (2xx status)
      if (res.statusCode >= 200 && res.statusCode < 300) {
        // Track deployment asynchronously without blocking response
        BillingService.incrementDeploymentCount(req.user.id).catch((error) => {
          logger.error('Error tracking deployment:', error);
        });
      }

      return originalJson(data);
    };

    next();
  } catch (error) {
    logger.error('Error in track deployment middleware:', error);
    next(error);
  }
};

/**
 * Middleware to verify user tier has feature access
 */
const checkFeatureAccess = (requiredFeature) => {
  return async (req, res, next) => {
    try {
      if (!req.user || !req.user.id) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      const billing = await require('../models/Billing').findOne({
        userId: req.user.id,
      }).populate('accountTierId');

      if (!billing || !billing.accountTierId) {
        return res.status(403).json({
          error: 'Feature not available',
          message: 'Please upgrade your account to access this feature',
        });
      }

      const tier = billing.accountTierId;
      const hasAccess = tier.features && tier.features[requiredFeature];

      if (!hasAccess) {
        return res.status(403).json({
          error: 'Feature not available for your tier',
          message: `The ${requiredFeature} feature is not available in your current plan. Please upgrade to access this feature.`,
          currentTier: tier.name,
        });
      }

      next();
    } catch (error) {
      logger.error('Error checking feature access:', error);
      res.status(500).json({ error: 'Failed to verify feature access' });
    }
  };
};

module.exports = {
  checkDeploymentLimit,
  trackDeployment,
  checkFeatureAccess,
};
