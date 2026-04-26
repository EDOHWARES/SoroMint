const mongoose = require('mongoose');

const WebhookSchema = new mongoose.Schema({
  ownerPublicKey: { type: String, required: true, index: true },
  url: { type: String, required: true },
  secret: { type: String, required: true },
  events: {
    type: [String],
    enum: ['token.minted', 'token.transferred', 'token.burned'],
    default: ['token.minted'],
  },
  active: { type: Boolean, default: true },
}, { timestamps: true });

module.exports = mongoose.model('Webhook', WebhookSchema);
