const mongoose = require('mongoose');

/**
 * @title DeploymentAudit Model
 * @author SoroMint Team
 * @notice Stores audit logs for token deployment actions
 * @dev Captures user actions for history and troubleshooting
 */

const DeploymentAuditSchema = new mongoose.Schema(
  {
    /**
     * Reference to the user who initiated the deployment
     */
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'User ID is required'],
    },
    /**
     * Name of the token being deployed
     */
    tokenName: {
      type: String,
      required: [true, 'Token name is required'],
      trim: true,
    },
    /**
     * Stellar contract address (C... format)
     * Populated on SUCCESS
     */
    contractId: {
      type: String,
      trim: true,
    },
    /**
     * Deployment status
     */
    status: {
      type: String,
      enum: ['SUCCESS', 'FAIL'],
      required: [true, 'Status is required'],
    },
    /**
     * Detailed error message for troubleshooting
     * Populated on FAIL
     */
    errorMessage: {
      type: String,
      trim: true,
    },
    /**
     * Timestamp of the deployment action
     */
    createdAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
  }
);

/**
 * @notice Composite index for the most common user timeline query
 */
DeploymentAuditSchema.index({ userId: 1, createdAt: -1 });

/**
 * @notice Composite index for status-based filtering and ordering
 */
DeploymentAuditSchema.index({ status: 1, createdAt: -1 });

/**
 * @notice Composite index for user + status history lookups
 */
DeploymentAuditSchema.index({ userId: 1, status: 1, createdAt: -1 });

/**
 * @notice Index for token name lookups used in admin filters
 */
DeploymentAuditSchema.index({ tokenName: 1, createdAt: -1 });

module.exports = mongoose.model('DeploymentAudit', DeploymentAuditSchema);
