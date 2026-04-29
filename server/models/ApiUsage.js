const mongoose = require('mongoose');

/**
 * @title ApiUsage Model
 * @author SoroMint Team
 * @notice Per-request usage log for the Developer API Gateway
 * @dev Used to compute usage statistics and quotas. A TTL index keeps the
 *      collection from growing unbounded (default 90 days).
 */

const USAGE_RETENTION_DAYS = 90;

const ApiUsageSchema = new mongoose.Schema(
  {
    apiKeyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'ApiKey',
      required: true,
      index: true,
    },
    ownerPublicKey: {
      type: String,
      required: true,
      index: true,
    },
    method: { type: String, required: true },
    path: { type: String, required: true },
    statusCode: { type: Number, required: true },
    durationMs: { type: Number, default: 0 },
    ip: { type: String },
    userAgent: { type: String },
    timestamp: {
      type: Date,
      default: Date.now,
      index: true,
    },
  },
  { versionKey: false }
);

ApiUsageSchema.index(
  { timestamp: 1 },
  { expireAfterSeconds: USAGE_RETENTION_DAYS * 24 * 60 * 60 }
);
ApiUsageSchema.index({ apiKeyId: 1, timestamp: -1 });

const ApiUsage = mongoose.model('ApiUsage', ApiUsageSchema);

module.exports = ApiUsage;
module.exports.USAGE_RETENTION_DAYS = USAGE_RETENTION_DAYS;
