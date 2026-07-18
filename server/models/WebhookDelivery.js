const mongoose = require('mongoose');

const WebhookDeliverySchema = new mongoose.Schema(
  {
    webhookId: { type: mongoose.Schema.Types.ObjectId, ref: 'Webhook', required: true, index: true },
    event: { type: String, required: true },
    data: { type: mongoose.Schema.Types.Mixed, required: true },
    status: {
      type: String,
      enum: ['PENDING', 'SUCCESS', 'FAILED', 'DLQ'],
      default: 'PENDING',
      index: true,
    },
    attempts: { type: Number, default: 0 },
    nextRetryAt: { type: Date },
    errorLogs: [{ type: String }],
  },
  { timestamps: true }
);

module.exports = mongoose.model('WebhookDelivery', WebhookDeliverySchema);
