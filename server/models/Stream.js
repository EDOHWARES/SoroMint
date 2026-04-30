const mongoose = require('mongoose');

/**
 * @title Stream Schema
 * @description MongoDB schema for payment streams on the SoroMint platform
 * @notice Stores metadata for token streams between users
 */

const StreamSchema = new mongoose.Schema({
  /**
   * @property {string} senderAddress - Stellar public key of the sender
   */
  senderAddress: {
    type: String,
    required: true,
    index: true, // Issue #510: Index senderAddress
  },
  /**
   * @property {string} recipientAddress - Stellar public key of the recipient
   */
  recipientAddress: {
    type: String,
    required: true,
    index: true, // Issue #510: Index recipientAddress
  },
  /**
   * @property {string} tokenContractId - The contract ID of the token being streamed
   */
  tokenContractId: {
    type: String,
    required: true,
  },
  /**
   * @property {string} amount - Total amount to be streamed (as string to handle i128)
   */
  amount: {
    type: String,
    required: true,
  },
  /**
   * @property {string} status - Current status of the stream (active, completed, cancelled)
   */
  status: {
    type: String,
    enum: ['active', 'completed', 'cancelled'],
    default: 'active',
  },
  /**
   * @property {Date} createdAt - Timestamp of stream creation
   */
  createdAt: {
    type: Date,
    default: Date.now,
  }
});

// Issue #510: Compound index for status and createdAt
StreamSchema.index({ status: 1, createdAt: -1 });

/**
 * @type {mongoose.Model}
 */
module.exports = mongoose.model('Stream', StreamSchema);
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
    cancellationDelay: {
      type: Number,
      default: 0,
      min: 0,
    },
    irrevocable: {
      type: Boolean,
      default: false,
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
