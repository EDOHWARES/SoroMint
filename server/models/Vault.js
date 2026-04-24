const mongoose = require('mongoose');

const CollateralSchema = new mongoose.Schema({
  tokenAddress: {
    type: String,
    required: true,
  },
  amount: {
    type: String,
    required: true,
  },
  valueUsd: {
    type: Number,
  },
}, { _id: false });

const VaultSchema = new mongoose.Schema({
  vaultId: {
    type: String,
    required: true,
    unique: true,
    index: true,
  },
  contractAddress: {
    type: String,
    required: true,
  },
  owner: {
    type: String,
    required: true,
    index: true,
  },
  collaterals: [CollateralSchema],
  debt: {
    type: String,
    required: true,
  },
  collateralizationRatio: {
    type: Number,
    index: true,
  },
  status: {
    type: String,
    enum: ['active', 'liquidated', 'closed'],
    default: 'active',
    index: true,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
  lastUpdated: {
    type: Date,
    default: Date.now,
  },
  liquidationHistory: [{
    liquidator: String,
    debtCovered: String,
    collateralSeized: String,
    timestamp: Date,
  }],
}, {
  timestamps: true
});

VaultSchema.index({ owner: 1, status: 1 });
VaultSchema.index({ collateralizationRatio: 1, status: 1 });

VaultSchema.methods.isHealthy = function(liquidationThreshold = 130) {
  return this.collateralizationRatio >= liquidationThreshold;
};

VaultSchema.methods.isLiquidatable = function(liquidationThreshold = 130) {
  return this.status === 'active' && this.collateralizationRatio < liquidationThreshold;
};

module.exports = mongoose.model('Vault', VaultSchema);
