const mongoose = require('mongoose');

const anomalyAlertSchema = new mongoose.Schema(
  {
    userId: {
      type: String,
      required: true,
      index: true,
    },
    alertType: {
      type: String,
      enum: [
        'rapid_stream_cycles',
        'excessive_withdrawals',
        'rapid_cancel_withdraw',
        'unusual_volume',
        'rate_limit_abuse',
        'suspicious_pattern',
      ],
      required: true,
    },
    severity: {
      type: String,
      enum: ['low', 'medium', 'high', 'critical'],
      default: 'medium',
      index: true,
    },
    description: {
      type: String,
      required: true,
    },
    details: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    transactionIds: [
      {
        type: String,
      },
    ],
    streamIds: [
      {
        type: String,
      },
    ],
    status: {
      type: String,
      enum: ['open', 'reviewing', 'resolved', 'false_alarm'],
      default: 'open',
      index: true,
    },
    reviewedBy: {
      type: String,
    },
    reviewNote: {
      type: String,
    },
    isNotified: {
      type: Boolean,
      default: false,
    },
    notificationChannels: {
      discord: Boolean,
      slack: Boolean,
      email: Boolean,
    },
    metadata: {
      ipAddress: String,
      userAgent: String,
      requestCount: Number,
      timeWindow: String,
    },
  },
  {
    timestamps: true,
  }
);

anomalyAlertSchema.index({ userId: 1, createdAt: -1 });
anomalyAlertSchema.index({ alertType: 1, severity: 1 });
anomalyAlertSchema.index({ status: 1, severity: 1 });
anomalyAlertSchema.index({ isNotified: 1, status: 1 });

module.exports = mongoose.model('AnomalyAlert', anomalyAlertSchema);
