const mongoose = require('mongoose');

const streamingTokenWhitelistSchema = new mongoose.Schema(
  {
    tokenAddress: {
      type: String,
      required: true,
      unique: true,
      index: true,
      trim: true,
    },
    tokenName: {
      type: String,
      trim: true,
      default: '',
    },
    tokenSymbol: {
      type: String,
      trim: true,
      default: '',
    },
    category: {
      type: String,
      enum: ['stablecoin', 'platform'],
      required: true,
      index: true,
    },
    notes: {
      type: String,
      trim: true,
      default: '',
    },
    active: {
      type: Boolean,
      default: true,
      index: true,
    },
    createdBy: {
      type: String,
      default: '',
    },
    updatedBy: {
      type: String,
      default: '',
    },
    deactivatedBy: {
      type: String,
      default: '',
    },
    deactivatedAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

streamingTokenWhitelistSchema.index({ active: 1, category: 1 });

module.exports = mongoose.model(
  'StreamingTokenWhitelist',
  streamingTokenWhitelistSchema
);
