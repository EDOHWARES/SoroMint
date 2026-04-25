const mongoose = require('mongoose');

const streamSchema = new mongoose.Schema(
  {
    streamId: {
      type: String,
      unique: true,
      index: true,
      sparse: true,
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
      enum: ['scheduled', 'active', 'completed', 'canceled'],
      default: 'active',
      index: true,
    },
    scheduledStartLedger: {
      type: Number,
      index: true,
    },
    createdTxHash: {
      type: String,
    },
    canceledTxHash: {
      type: String,
    },
  },
  {
    timestamps: true,
  }
);

streamSchema.index({ sender: 1, status: 1 });
streamSchema.index({ recipient: 1, status: 1 });

module.exports = mongoose.model('Stream', streamSchema);
