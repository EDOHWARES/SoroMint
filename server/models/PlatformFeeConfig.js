const mongoose = require('mongoose');

const platformFeeConfigSchema = new mongoose.Schema(
  {
    tokenAddress: {
      type: String,
      required: true,
      index: true,
    },
    feePercentage: {
      type: Number,
      required: true,
      min: 0,
      max: 100, // Max 100% fee
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    minFeeAmount: {
      type: String,
      default: '0',
    },
    maxFeeAmount: {
      type: String,
    },
    description: {
      type: String,
    },
    updatedBy: {
      type: String,
      required: true,
    },
  },
  {
    timestamps: true,
  }
);

platformFeeConfigSchema.index({ tokenAddress: 1, isActive: 1 });

module.exports = mongoose.model('PlatformFeeConfig', platformFeeConfigSchema);
