const express = require('express');
const router = express.Router();
const BillingService = require('../services/billing-service');
const AccountTier = require('../models/AccountTier');
const Billing = require('../models/Billing');
const DeploymentUsage = require('../models/DeploymentUsage');
const logger = require('winston');

// Middleware to verify authentication
const authenticateUser = (req, res, next) => {
  if (!req.user || !req.user.id) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
};

/**
 * @route GET /billing/tiers
 * @description Get all available account tiers
 * @access Public
 */
router.get('/tiers', async (req, res) => {
  try {
    const tiers = await AccountTier.find({ isActive: true }).sort('displayOrder');
    res.json(tiers);
  } catch (error) {
    logger.error('Error fetching tiers:', error);
    res.status(500).json({ error: 'Failed to fetch tiers' });
  }
});

/**
 * @route GET /billing/tiers/:id
 * @description Get a specific account tier
 * @access Public
 */
router.get('/tiers/:id', async (req, res) => {
  try {
    const tier = await AccountTier.findById(req.params.id);
    if (!tier) {
      return res.status(404).json({ error: 'Tier not found' });
    }
    res.json(tier);
  } catch (error) {
    logger.error('Error fetching tier:', error);
    res.status(500).json({ error: 'Failed to fetch tier' });
  }
});

/**
 * @route GET /billing/info
 * @description Get current user's billing information
 * @access Private
 */
router.get('/info', authenticateUser, async (req, res) => {
  try {
    const billing = await BillingService.getBillingInfo(req.user.id);
    res.json(billing);
  } catch (error) {
    logger.error('Error fetching billing info:', error);
    res.status(500).json({ error: 'Failed to fetch billing information' });
  }
});

/**
 * @route GET /billing/usage
 * @description Get current deployment usage for user
 * @access Private
 */
router.get('/usage', authenticateUser, async (req, res) => {
  try {
    const usage = await BillingService.getDeploymentUsage(req.user.id);
    if (!usage) {
      return res.json({
        deploymentsCount: 0,
        maxDeployments: null,
        percentageUsed: 0,
        isLimitExceeded: false,
      });
    }
    res.json(usage);
  } catch (error) {
    logger.error('Error fetching deployment usage:', error);
    res.status(500).json({ error: 'Failed to fetch usage information' });
  }
});

/**
 * @route POST /billing/create-customer
 * @description Create a Stripe customer for the user
 * @access Private
 */
router.post('/create-customer', authenticateUser, async (req, res) => {
  try {
    // Check if customer already exists
    let billing = await Billing.findOne({ userId: req.user.id });
    if (billing && billing.stripeCustomerId) {
      return res.json({
        message: 'Customer already exists',
        billing,
      });
    }

    billing = await BillingService.createStripeCustomer(req.user.id, req.user.email);
    res.json(billing);
  } catch (error) {
    logger.error('Error creating Stripe customer:', error);
    res.status(500).json({ error: 'Failed to create customer' });
  }
});

/**
 * @route POST /billing/subscribe
 * @description Subscribe user to a tier
 * @access Private
 * @body {string} tierName - The tier name (free, pro, enterprise)
 */
router.post('/subscribe', authenticateUser, async (req, res) => {
  try {
    const { tierName } = req.body;

    if (!tierName) {
      return res.status(400).json({ error: 'Tier name is required' });
    }

    const tier = await AccountTier.findOne({
      name: tierName.toLowerCase(),
    });

    if (!tier) {
      return res.status(404).json({ error: 'Tier not found' });
    }

    let billing = await Billing.findOne({ userId: req.user.id });

    if (!billing) {
      billing = await BillingService.createStripeCustomer(req.user.id, req.user.email);
    }

    // If free tier, just update the tier
    if (tier.name === 'free') {
      return res.json({
        message: 'Subscribed to free tier',
        billing,
      });
    }

    // For paid tiers, create a Stripe subscription
    if (!tier.stripePriceId) {
      return res.status(400).json({ error: 'Tier is not available for purchase' });
    }

    const subscription = await BillingService.createSubscription(
      req.user.id,
      tier.stripePriceId
    );

    res.json({
      message: 'Subscription created',
      subscription,
    });
  } catch (error) {
    logger.error('Error subscribing to tier:', error);
    res.status(500).json({ error: 'Failed to subscribe to tier' });
  }
});

/**
 * @route POST /billing/upgrade
 * @description Upgrade user to a higher tier
 * @access Private
 * @body {string} tierName - The tier name (pro, enterprise)
 */
router.post('/upgrade', authenticateUser, async (req, res) => {
  try {
    const { tierName } = req.body;

    if (!tierName) {
      return res.status(400).json({ error: 'Tier name is required' });
    }

    const result = await BillingService.upgradeTier(req.user.id, tierName);
    res.json({
      message: `Upgraded to ${tierName} tier`,
      ...result,
    });
  } catch (error) {
    logger.error('Error upgrading tier:', error);
    res.status(500).json({ error: 'Failed to upgrade tier' });
  }
});

/**
 * @route POST /billing/downgrade
 * @description Downgrade user to a lower tier
 * @access Private
 * @body {string} tierName - The tier name (free, pro)
 */
router.post('/downgrade', authenticateUser, async (req, res) => {
  try {
    const { tierName } = req.body;

    if (!tierName) {
      return res.status(400).json({ error: 'Tier name is required' });
    }

    const result = await BillingService.downgradeTier(req.user.id, tierName);
    res.json({
      message: `Downgraded to ${tierName} tier`,
      ...result,
    });
  } catch (error) {
    logger.error('Error downgrading tier:', error);
    res.status(500).json({ error: 'Failed to downgrade tier' });
  }
});

/**
 * @route POST /billing/cancel-subscription
 * @description Cancel user's subscription
 * @access Private
 * @body {boolean} cancelAtPeriodEnd - Whether to cancel at end of period (default: true)
 */
router.post('/cancel-subscription', authenticateUser, async (req, res) => {
  try {
    const { cancelAtPeriodEnd = true } = req.body;

    const result = await BillingService.cancelSubscription(req.user.id, cancelAtPeriodEnd);
    res.json({
      message: 'Subscription canceled',
      billing: result,
    });
  } catch (error) {
    logger.error('Error canceling subscription:', error);
    res.status(500).json({ error: 'Failed to cancel subscription' });
  }
});

/**
 * @route GET /billing/deployment-limit-status
 * @description Get deployment limit status for current user
 * @access Private
 */
router.get('/deployment-limit-status', authenticateUser, async (req, res) => {
  try {
    const usage = await BillingService.getDeploymentUsage(req.user.id);

    if (!usage) {
      return res.json({
        canDeploy: true,
        remaining: null,
        message: 'No limit',
      });
    }

    const canDeploy = !usage.isLimitExceeded && 
                      (!usage.maxDeployments || usage.deploymentsCount < usage.maxDeployments);
    const remaining = usage.maxDeployments
      ? usage.maxDeployments - usage.deploymentsCount
      : null;

    res.json({
      canDeploy,
      used: usage.deploymentsCount,
      limit: usage.maxDeployments,
      remaining,
      percentageUsed: usage.percentageUsed,
      periodStart: usage.periodStart,
      periodEnd: usage.periodEnd,
    });
  } catch (error) {
    logger.error('Error getting deployment limit status:', error);
    res.status(500).json({ error: 'Failed to get deployment limit status' });
  }
});

/**
 * @route POST /billing/webhook/stripe
 * @description Stripe webhook endpoint
 * @access Public (verified via signature)
 */
router.post('/webhook/stripe', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!webhookSecret || !sig) {
    return res.status(400).json({ error: 'Missing webhook configuration' });
  }

  try {
    const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
    const event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);

    await BillingService.handleStripeWebhook(event);
    res.json({ received: true });
  } catch (error) {
    logger.error('Webhook signature verification failed:', error);
    res.status(400).json({ error: 'Webhook signature verification failed' });
  }
});

module.exports = router;
