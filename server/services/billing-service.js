const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const User = require('../models/User');
const AccountTier = require('../models/AccountTier');
const Billing = require('../models/Billing');
const DeploymentUsage = require('../models/DeploymentUsage');
const logger = require('winston');

/**
 * @title Billing Service
 * @author SoroMint Team
 * @notice Manages Stripe integration and billing operations
 * @dev Handles tier management, subscription lifecycle, and deployment limits
 */

class BillingService {
  /**
   * Initialize account tiers in the database
   */
  static async initializeAccountTiers() {
    try {
      const existingTiers = await AccountTier.countDocuments();
      if (existingTiers > 0) {
        logger.info('Account tiers already initialized');
        return;
      }

      const tiers = [
        {
          name: 'free',
          displayName: 'Free',
          monthlyPriceCents: 0,
          maxDeploymentsPerMonth: 10,
          softLimitPercentage: 80,
          displayOrder: 1,
          description: 'Get started with SoroMint',
          features: {
            advancedAnalytics: false,
            multiSigDeployment: false,
            customNetworks: false,
            prioritySupport: false,
            webhooks: false,
            apiAccess: true,
          },
          isActive: true,
        },
        {
          name: 'pro',
          displayName: 'Pro',
          monthlyPriceCents: 2999, // $29.99
          maxDeploymentsPerMonth: 100,
          softLimitPercentage: 80,
          displayOrder: 2,
          description: 'For growing projects',
          features: {
            advancedAnalytics: true,
            multiSigDeployment: true,
            customNetworks: true,
            prioritySupport: true,
            webhooks: true,
            apiAccess: true,
          },
          isActive: true,
        },
        {
          name: 'enterprise',
          displayName: 'Enterprise',
          monthlyPriceCents: 9999, // $99.99
          maxDeploymentsPerMonth: null, // Unlimited
          softLimitPercentage: 80,
          displayOrder: 3,
          description: 'For enterprise-scale operations',
          features: {
            advancedAnalytics: true,
            multiSigDeployment: true,
            customNetworks: true,
            prioritySupport: true,
            webhooks: true,
            apiAccess: true,
          },
          isActive: true,
        },
      ];

      const createdTiers = await AccountTier.insertMany(tiers);
      logger.info(`Created ${createdTiers.length} account tiers`);
      return createdTiers;
    } catch (error) {
      logger.error('Error initializing account tiers:', error);
      throw error;
    }
  }

  /**
   * Create a Stripe customer and billing record for a user
   */
  static async createStripeCustomer(userId, email) {
    try {
      const user = await User.findById(userId);
      if (!user) {
        throw new Error('User not found');
      }

      // Get free tier by default
      const freeTier = await AccountTier.findOne({ name: 'free' });
      if (!freeTier) {
        throw new Error('Free tier not found');
      }

      // Create Stripe customer
      const stripeCustomer = await stripe.customers.create({
        email: email || user.email,
        metadata: {
          userId: userId.toString(),
          publicKey: user.publicKey || '',
        },
      });

      // Create billing record
      const billing = new Billing({
        userId,
        accountTierId: freeTier._id,
        stripeCustomerId: stripeCustomer.id,
        subscriptionStatus: 'active',
        lastPaymentStatus: 'succeeded',
      });

      await billing.save();

      // Update user tier
      user.accountTierId = freeTier._id;
      user.tierChangedAt = new Date();
      await user.save();

      logger.info(`Created Stripe customer for user ${userId}`);
      return billing;
    } catch (error) {
      logger.error('Error creating Stripe customer:', error);
      throw error;
    }
  }

  /**
   * Create a subscription for a user
   */
  static async createSubscription(userId, stripePriceId) {
    try {
      const billing = await Billing.findOne({ userId });
      if (!billing) {
        throw new Error('Billing record not found');
      }

      if (!billing.stripeCustomerId) {
        throw new Error('Stripe customer ID not found');
      }

      // Create subscription
      const subscription = await stripe.subscriptions.create({
        customer: billing.stripeCustomerId,
        items: [{ price: stripePriceId }],
        payment_behavior: 'default_incomplete',
        expand: ['latest_invoice.payment_intent'],
        metadata: {
          userId: userId.toString(),
        },
      });

      // Update billing with subscription info
      billing.stripeSubscriptionId = subscription.id;
      billing.subscriptionStatus = subscription.status;
      billing.currentPeriodStart = new Date(subscription.current_period_start * 1000);
      billing.currentPeriodEnd = new Date(subscription.current_period_end * 1000);
      billing.isTrialing = subscription.trial_end ? true : false;
      if (subscription.trial_end) {
        billing.trialEndDate = new Date(subscription.trial_end * 1000);
      }

      await billing.save();

      logger.info(`Created subscription for user ${userId}`);
      return subscription;
    } catch (error) {
      logger.error('Error creating subscription:', error);
      throw error;
    }
  }

  /**
   * Upgrade user tier
   */
  static async upgradeTier(userId, tierName) {
    try {
      const user = await User.findById(userId);
      if (!user) {
        throw new Error('User not found');
      }

      const newTier = await AccountTier.findOne({ name: tierName.toLowerCase() });
      if (!newTier) {
        throw new Error('Tier not found');
      }

      const billing = await Billing.findOne({ userId });
      if (!billing) {
        throw new Error('Billing record not found');
      }

      // If user has active subscription, update it
      if (billing.stripeSubscriptionId && newTier.stripePriceId) {
        const subscription = await stripe.subscriptions.retrieve(
          billing.stripeSubscriptionId
        );

        // Update the subscription with the new price
        await stripe.subscriptions.update(billing.stripeSubscriptionId, {
          items: [
            {
              id: subscription.items.data[0].id,
              price: newTier.stripePriceId,
            },
          ],
          proration_behavior: 'create_prorations',
        });
      }

      // Update user and billing
      user.accountTierId = newTier._id;
      user.tierChangedAt = new Date();
      await user.save();

      billing.accountTierId = newTier._id;
      await billing.save();

      logger.info(`Upgraded user ${userId} to ${tierName} tier`);
      return { user, billing };
    } catch (error) {
      logger.error('Error upgrading tier:', error);
      throw error;
    }
  }

  /**
   * Downgrade user tier
   */
  static async downgradeTier(userId, tierName) {
    try {
      return await this.upgradeTier(userId, tierName);
    } catch (error) {
      logger.error('Error downgrading tier:', error);
      throw error;
    }
  }

  /**
   * Get current billing period for user
   */
  static getCurrentBillingPeriod() {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth() + 1;
    return { year, month };
  }

  /**
   * Increment deployment count for user
   */
  static async incrementDeploymentCount(userId) {
    try {
      const { year, month } = this.getCurrentBillingPeriod();

      const user = await User.findById(userId).populate('accountTierId');
      if (!user) {
        throw new Error('User not found');
      }

      const tier = user.accountTierId;
      if (!tier) {
        throw new Error('User tier not found');
      }

      // Find or create usage record for this period
      let usage = await DeploymentUsage.findOne({
        userId,
        year,
        month,
      });

      if (!usage) {
        const periodStart = new Date(year, month - 1, 1);
        const periodEnd = new Date(year, month, 0);

        usage = new DeploymentUsage({
          userId,
          accountTierId: tier._id,
          year,
          month,
          deploymentsCount: 0,
          maxDeployments: tier.maxDeploymentsPerMonth,
          periodStartDate: periodStart,
          periodEndDate: periodEnd,
        });
      }

      // Check hard limit
      if (
        tier.maxDeploymentsPerMonth &&
        usage.deploymentsCount >= tier.maxDeploymentsPerMonth
      ) {
        throw new Error(
          `Hard limit reached: ${tier.maxDeploymentsPerMonth} deployments per month`
        );
      }

      // Increment count
      usage.deploymentsCount += 1;
      usage.lastDeploymentAt = new Date();

      // Check soft limit
      if (tier.maxDeploymentsPerMonth) {
        const usagePercentage =
          (usage.deploymentsCount / tier.maxDeploymentsPerMonth) * 100;

        if (
          usagePercentage >= tier.softLimitPercentage &&
          usage.softLimitWarningsSent === 0
        ) {
          usage.softLimitWarningsSent += 1;
          // TODO: Send soft limit warning notification
          logger.warn(
            `Soft limit warning for user ${userId}: ${usagePercentage.toFixed(2)}% of monthly deployments used`
          );
        }
      }

      await usage.save();

      // Update user total deployments
      user.totalDeployments += 1;
      await user.save();

      return usage;
    } catch (error) {
      logger.error('Error incrementing deployment count:', error);
      throw error;
    }
  }

  /**
   * Get deployment usage for user in current period
   */
  static async getDeploymentUsage(userId) {
    try {
      const { year, month } = this.getCurrentBillingPeriod();

      const usage = await DeploymentUsage.findOne({
        userId,
        year,
        month,
      }).populate('accountTierId');

      if (!usage) {
        return null;
      }

      return {
        deploymentsCount: usage.deploymentsCount,
        maxDeployments: usage.maxDeployments,
        percentageUsed: usage.maxDeployments
          ? (usage.deploymentsCount / usage.maxDeployments) * 100
          : 0,
        isLimitExceeded: usage.isLimitExceeded,
        periodStart: usage.periodStartDate,
        periodEnd: usage.periodEndDate,
      };
    } catch (error) {
      logger.error('Error getting deployment usage:', error);
      throw error;
    }
  }

  /**
   * Cancel subscription for user
   */
  static async cancelSubscription(userId, cancelAtPeriodEnd = true) {
    try {
      const billing = await Billing.findOne({ userId });
      if (!billing) {
        throw new Error('Billing record not found');
      }

      if (!billing.stripeSubscriptionId) {
        throw new Error('No active subscription');
      }

      await stripe.subscriptions.update(billing.stripeSubscriptionId, {
        cancel_at_period_end: cancelAtPeriodEnd,
      });

      billing.subscriptionStatus = 'canceled';
      billing.canceledAt = new Date();
      await billing.save();

      logger.info(`Canceled subscription for user ${userId}`);
      return billing;
    } catch (error) {
      logger.error('Error canceling subscription:', error);
      throw error;
    }
  }

  /**
   * Get billing information for user
   */
  static async getBillingInfo(userId) {
    try {
      const billing = await Billing.findOne({ userId })
        .populate('accountTierId')
        .populate('userId', 'email username');

      if (!billing) {
        throw new Error('Billing record not found');
      }

      return billing;
    } catch (error) {
      logger.error('Error getting billing info:', error);
      throw error;
    }
  }

  /**
   * Handle Stripe webhook events
   */
  static async handleStripeWebhook(event) {
    try {
      switch (event.type) {
        case 'customer.subscription.updated':
          await this.handleSubscriptionUpdated(event.data.object);
          break;

        case 'customer.subscription.deleted':
          await this.handleSubscriptionDeleted(event.data.object);
          break;

        case 'invoice.payment_succeeded':
          await this.handlePaymentSucceeded(event.data.object);
          break;

        case 'invoice.payment_failed':
          await this.handlePaymentFailed(event.data.object);
          break;

        default:
          logger.debug(`Unhandled webhook event type: ${event.type}`);
      }

      return { received: true };
    } catch (error) {
      logger.error('Error handling Stripe webhook:', error);
      throw error;
    }
  }

  /**
   * Handle subscription updated event
   */
  static async handleSubscriptionUpdated(subscription) {
    try {
      const billing = await Billing.findOne({
        stripeSubscriptionId: subscription.id,
      });

      if (!billing) {
        logger.warn(`Billing record not found for subscription ${subscription.id}`);
        return;
      }

      billing.subscriptionStatus = subscription.status;
      billing.currentPeriodStart = new Date(
        subscription.current_period_start * 1000
      );
      billing.currentPeriodEnd = new Date(subscription.current_period_end * 1000);

      await billing.save();
      logger.info(`Updated subscription ${subscription.id}`);
    } catch (error) {
      logger.error('Error handling subscription updated:', error);
      throw error;
    }
  }

  /**
   * Handle subscription deleted event
   */
  static async handleSubscriptionDeleted(subscription) {
    try {
      const billing = await Billing.findOne({
        stripeSubscriptionId: subscription.id,
      });

      if (!billing) {
        logger.warn(`Billing record not found for subscription ${subscription.id}`);
        return;
      }

      // Reset to free tier
      const freeTier = await AccountTier.findOne({ name: 'free' });
      const user = await User.findById(billing.userId);

      if (freeTier && user) {
        user.accountTierId = freeTier._id;
        user.tierChangedAt = new Date();
        await user.save();

        billing.accountTierId = freeTier._id;
        billing.subscriptionStatus = 'canceled';
        billing.canceledAt = new Date();
        await billing.save();
      }

      logger.info(`Deleted subscription ${subscription.id}, reverted to free tier`);
    } catch (error) {
      logger.error('Error handling subscription deleted:', error);
      throw error;
    }
  }

  /**
   * Handle payment succeeded event
   */
  static async handlePaymentSucceeded(invoice) {
    try {
      const billing = await Billing.findOne({
        stripeSubscriptionId: invoice.subscription,
      });

      if (!billing) {
        logger.warn(
          `Billing record not found for subscription ${invoice.subscription}`
        );
        return;
      }

      billing.lastPaymentAt = new Date();
      billing.lastPaymentStatus = 'succeeded';
      billing.totalPaidCents += invoice.amount_paid;
      billing.failedPaymentCount = 0;
      await billing.save();

      logger.info(`Payment succeeded for user ${billing.userId}`);
    } catch (error) {
      logger.error('Error handling payment succeeded:', error);
      throw error;
    }
  }

  /**
   * Handle payment failed event
   */
  static async handlePaymentFailed(invoice) {
    try {
      const billing = await Billing.findOne({
        stripeSubscriptionId: invoice.subscription,
      });

      if (!billing) {
        logger.warn(
          `Billing record not found for subscription ${invoice.subscription}`
        );
        return;
      }

      billing.lastPaymentStatus = 'failed';
      billing.failedPaymentCount += 1;
      await billing.save();

      logger.warn(
        `Payment failed for user ${billing.userId}, attempt ${billing.failedPaymentCount}`
      );
      // TODO: Send email notification about failed payment
    } catch (error) {
      logger.error('Error handling payment failed:', error);
      throw error;
    }
  }
}

module.exports = BillingService;
