const mongoose = require('mongoose');

const GovernanceConfigSchema = new mongoose.Schema({
  tokenId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Token',
    unique: true,
    required: true,
  },
  balanceMultiplier: {
    type: Number,
    default: 1,
  },
  contributionMultiplier: {
    type: Number,
    default: 0, // Disabled by default
  },
  deploymentMultiplier: {
    type: Number,
    default: 0, // Disabled by default
  },

  minBalance: {
    type: Number,
    default: 0,
  },

  updatedAt: {
    type: Date,
    default: Date.now,
  },
});

module.exports = mongoose.model('GovernanceConfig', GovernanceConfigSchema);
