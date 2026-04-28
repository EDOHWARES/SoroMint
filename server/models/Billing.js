const mongoose = require('mongoose');

/**
 * @title Billing Model
 * @author SoroMint Team
 * @notice Tracks user billing and subscription information
 * @dev Manages Stripe subscription lifecycle and tier changes
 */

const BillingSchema = new mongoose.Schema(
  {
    /**
     * Reference to the User
     */
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      unique: true,
      index: true,
    },

    /**
     * Reference to the AccountTier
     */
    accountTierId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'AccountTier',
      required: true,
      default: null, // Will be set to free tier by default
    },

    /**
     * Stripe customer ID
     */
    stripeCustomerId: {
      type: String,
      unique: true,
      sparse: true,
      index: true,
    },

    /**
     * Current subscription ID from Stripe
     */
    stripeSubscriptionId: {
      type: String,
      unique: true,
      sparse: true,
      index: true,
    },

    /**
     * Subscription status: active, canceled, past_due, trialing, incomplete, incomplete_expired
     */
    subscriptionStatus: {
      type: String,
      enum: ['active', 'canceled', 'past_due', 'trialing', 'incomplete', 'incomplete_expired', 'unpaid'],
      default: 'active',
    },

    /**
     * Current billing period start
     */
    currentPeriodStart: {
      type: Date,
    },

    /**
     * Current billing period end
     */
    currentPeriodEnd: {
      type: Date,
    },

    /**
     * Subscription cancellation date (if canceled)
     */
    canceledAt: {
      type: Date,
    },

    /**
     * Whether billing is automatic
     */
    autoRenew: {
      type: Boolean,
      default: true,
    },

    /**
     * Payment method ID from Stripe
     */
    paymentMethodId: {
      type: String,
      sparse: true,
    },

    /**
     * Last payment date
     */
    lastPaymentAt: {
      type: Date,
    },

    /**
     * Last payment status
     */
    lastPaymentStatus: {
      type: String,
      enum: ['succeeded', 'failed', 'pending'],
      default: 'succeeded',
    },

    /**
     * Total amount paid (in cents)
     */
    totalPaidCents: {
      type: Number,
      default: 0,
      min: [0, 'Total paid cannot be negative'],
    },

    /**
     * Number of times billing has failed
     */
    failedPaymentCount: {
      type: Number,
      default: 0,
      min: [0, 'Failed payment count cannot be negative'],
    },

    /**
     * Trial end date (if applicable)
     */
    trialEndDate: {
      type: Date,
    },

    /**
     * Whether the user is in trial period
     */
    isTrialing: {
      type: Boolean,
      default: false,
    },

    /**
     * Billing address
     */
    billingAddress: {
      line1: String,
      line2: String,
      city: String,
      state: String,
      postalCode: String,
      country: String,
    },

    /**
     * Metadata for custom fields
     */
    metadata: {
      type: Map,
      of: String,
      default: new Map(),
    },

    /**
     * Timestamps
     */
    createdAt: {
      type: Date,
      default: Date.now,
    },
    updatedAt: {
      type: Date,
      default: Date.now,
    },
  },
  { versionKey: false }
);

// Update the updatedAt timestamp before each save
BillingSchema.pre('save', function (next) {
  this.updatedAt = Date.now();
  next();
});

const Billing = mongoose.model('Billing', BillingSchema);

module.exports = Billing;
