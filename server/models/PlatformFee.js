const mongoose = require('mongoose');

const platformFeeSchema = new mongoose.Schema(
  {
    streamId: {
      type: String,
      required: true,
      index: true,
    },
    feeAmount: {
      type: String,
      required: true,
    },
    feePercentage: {
      type: Number,
      required: true,
    },
    streamTotalAmount: {
      type: String,
      required: true,
    },
    tokenAddress: {
      type: String,
      required: true,
    },
    status: {
      type: String,
      enum: ['collected', 'withdrawn', 'pending'],
      default: 'collected',
      index: true,
    },
    withdrawnAmount: {
      type: String,
      default: '0',
    },
    withdrawnTxHash: {
      type: String,
    },
    withdrawnAt: {
      type: Date,
    },
    withdrawnBy: {
      type: String,
    },
    collectionTxHash: {
      type: String,
      required: true,
    },
  },
  {
    timestamps: true,
  }
);

platformFeeSchema.index({ status: 1, createdAt: -1 });
platformFeeSchema.index({ tokenAddress: 1, status: 1 });

module.exports = mongoose.model('PlatformFee', platformFeeSchema);
