const mongoose = require('mongoose');

/**
 * @title DeploymentUsage Model
 * @author SoroMint Team
 * @notice Tracks token deployment usage per user per billing period
 * @dev Used to enforce hard limits and trigger soft limit warnings
 */

const DeploymentUsageSchema = new mongoose.Schema(
  {
    /**
     * Reference to the User
     */
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },

    /**
     * Reference to the AccountTier
     */
    accountTierId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'AccountTier',
      required: true,
    },

    /**
     * Billing period year
     */
    year: {
      type: Number,
      required: true,
    },

    /**
     * Billing period month (1-12)
     */
    month: {
      type: Number,
      required: true,
      min: 1,
      max: 12,
    },

    /**
     * Current deployment count for this billing period
     */
    deploymentsCount: {
      type: Number,
      default: 0,
      min: [0, 'Deployment count cannot be negative'],
    },

    /**
     * Maximum deployments allowed (from tier)
     */
    maxDeployments: {
      type: Number,
      default: null,
    },

    /**
     * Whether soft limit warning has been sent
     */
    softLimitWarningsSent: {
      type: Number,
      default: 0,
    },

    /**
     * Timestamp of last deployment
     */
    lastDeploymentAt: {
      type: Date,
    },

    /**
     * Billing period start date
     */
    periodStartDate: {
      type: Date,
      required: true,
    },

    /**
     * Billing period end date
     */
    periodEndDate: {
      type: Date,
      required: true,
    },

    /**
     * Whether the user is currently blocked due to exceeding hard limit
     */
    isLimitExceeded: {
      type: Boolean,
      default: false,
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

// Compound index for efficient user + billing period lookups
DeploymentUsageSchema.index({ userId: 1, year: 1, month: 1 }, { unique: true });

// Update the updatedAt timestamp before each save
DeploymentUsageSchema.pre('save', function (next) {
  this.updatedAt = Date.now();
  next();
});

const DeploymentUsage = mongoose.model('DeploymentUsage', DeploymentUsageSchema);

module.exports = DeploymentUsage;
