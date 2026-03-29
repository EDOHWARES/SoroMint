const mongoose = require('mongoose');

const NotificationPreferencesSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    unique: true,
  },
  email: {
    enabled: { type: Boolean, default: false },
    address: { type: String, trim: true, default: '' },
  },
  webPush: {
    enabled: { type: Boolean, default: false },
    subscription: {
      endpoint: { type: String, default: '' },
      keys: {
        p256dh: { type: String, default: '' },
        auth: { type: String, default: '' },
      },
    },
  },
  events: {
    tokenMinted: { type: Boolean, default: true },
    transactionConfirmed: { type: Boolean, default: true },
    deploymentFailed: { type: Boolean, default: true },
  },
}, {
  timestamps: true,
});

NotificationPreferencesSchema.index({ userId: 1 });

NotificationPreferencesSchema.statics.findByUserId = async function (userId) {
  let prefs = await this.findOne({ userId });
  if (!prefs) {
    prefs = await this.create({ userId });
  }
  return prefs;
};

module.exports = mongoose.model('NotificationPreferences', NotificationPreferencesSchema);
