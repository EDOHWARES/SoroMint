const mongoose = require('mongoose');

const streamSchema = new mongoose.Schema(
  {
    streamId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    contractId: {
      type: String,
      required: true,
    },
    sender: {
      type: String,
      required: true,
      index: true,
    },
    recipient: {
      type: String,
      required: true,
      index: true,
    },
    tokenAddress: {
      type: String,
      required: true,
    },
    totalAmount: {
      type: String,
      required: true,
    },
    ratePerLedger: {
      type: String,
      required: true,
    },
    startLedger: {
      type: Number,
      required: true,
    },
    stopLedger: {
      type: Number,
      required: true,
    },
    withdrawn: {
      type: String,
      default: '0',
    },
    status: {
      type: String,
      enum: ['active', 'completed', 'canceled'],
      default: 'active',
      index: true,
    },
    createdTxHash: {
      type: String,
      required: true,
    },
    canceledTxHash: {
      type: String,
    },
    metadata: {
      type: Map,
      of: mongoose.Schema.Types.Mixed,
      default: {},
      validate: {
        validator: function (value) {
          if (!value) return true;
          // Max 50 keys
          if (value.size > 50) return false;
          for (const [key, val] of value.entries()) {
            // Keys must be alphanumeric with underscores/hyphens, max 64 chars
            if (!/^[a-zA-Z0-9_-]{1,64}$/.test(key)) return false;
            // Values must be primitives (no nested objects to prevent injection)
            if (val !== null && typeof val === 'object') return false;
            // String values max 512 chars
            if (typeof val === 'string' && val.length > 512) return false;
          }
          return true;
        },
        message: 'Invalid metadata: max 50 keys, keys must be alphanumeric (max 64 chars), values must be primitives (max 512 chars)',
      },
    },
  },
  {
    timestamps: true,
  }
);

streamSchema.index({ sender: 1, status: 1 });
streamSchema.index({ recipient: 1, status: 1 });
streamSchema.index({ 'metadata.$**': 1 });

module.exports = mongoose.model('Stream', streamSchema);
