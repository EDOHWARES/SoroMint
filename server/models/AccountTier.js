const mongoose = require('mongoose');

/**
 * @title AccountTier Model
 * @author SoroMint Team
 * @notice Defines account tiers with deployment limits and pricing
 * @dev Used for tiered access control and billing management
 */

const AccountTierSchema = new mongoose.Schema(
  {
    /**
     * Tier name (Free, Pro, Enterprise)
     */
    name: {
      type: String,
      enum: ['free', 'pro', 'enterprise'],
      required: true,
      unique: true,
      lowercase: true,
    },

    /**
     * Human-readable display name
     */
    displayName: {
      type: String,
      required: true,
      enum: ['Free', 'Pro', 'Enterprise'],
    },

    /**
     * Monthly cost in cents (USD)
     */
    monthlyPriceCents: {
      type: Number,
      required: true,
      default: 0,
      min: [0, 'Price cannot be negative'],
    },

    /**
     * Hard limit: maximum token deployments per month
     * null means unlimited
     */
    maxDeploymentsPerMonth: {
      type: Number,
      default: null,
    },

    /**
     * Soft limit: deployment warning threshold (percentage)
     * e.g., 80 means warn when 80% of limit is reached
     */
    softLimitPercentage: {
      type: Number,
      default: 80,
      min: [0, 'Soft limit percentage cannot be below 0'],
      max: [100, 'Soft limit percentage cannot exceed 100'],
    },

    /**
     * Feature flags for different tiers
     */
    features: {
      advancedAnalytics: {
        type: Boolean,
        default: false,
      },
      multiSigDeployment: {
        type: Boolean,
        default: false,
      },
      customNetworks: {
        type: Boolean,
        default: false,
      },
      prioritySupport: {
        type: Boolean,
        default: false,
      },
      webhooks: {
        type: Boolean,
        default: false,
      },
      apiAccess: {
        type: Boolean,
        default: false,
      },
    },

    /**
     * Stripe product ID for this tier
     */
    stripeProductId: {
      type: String,
      sparse: true,
    },

    /**
     * Stripe price ID for monthly billing
     */
    stripePriceId: {
      type: String,
      sparse: true,
    },

    /**
     * Whether this tier is active and available for purchase
     */
    isActive: {
      type: Boolean,
      default: true,
    },

    /**
     * Display order for UI
     */
    displayOrder: {
      type: Number,
      default: 0,
    },

    /**
     * Description of the tier
     */
    description: {
      type: String,
      default: '',
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
AccountTierSchema.pre('save', function (next) {
  this.updatedAt = Date.now();
  next();
});

const AccountTier = mongoose.model('AccountTier', AccountTierSchema);

module.exports = AccountTier;
