const mongoose = require('mongoose');

const delegationSchema = new mongoose.Schema(
  {
    tokenContractId: {
      type: String,
      required: true,
      index: true,
    },
    owner: {
      type: String,
      required: true,
      index: true,
    },
    delegate: {
      type: String,
      required: true,
      index: true,
    },
    limit: {
      type: String, // Store as string to handle large numbers
      required: true,
    },
    minted: {
      type: String, // Store as string to handle large numbers
      default: '0',
    },
    sponsor: {
      type: String,
      default: null,
    },
    status: {
      type: String,
      enum: ['active', 'revoked', 'exhausted'],
      default: 'active',
      index: true,
    },
    createdAt: {
      type: Date,
      default: Date.now,
      index: true,
    },
    revokedAt: {
      type: Date,
      default: null,
    },
    lastMintedAt: {
      type: Date,
      default: null,
    },
    totalMintCount: {
      type: Number,
      default: 0,
    },
    notes: String,
  },
  { timestamps: true }
);

// Compound index for efficient queries
delegationSchema.index({ tokenContractId: 1, owner: 1, delegate: 1 }, { unique: true });
delegationSchema.index({ tokenContractId: 1, owner: 1, status: 1 });
delegationSchema.index({ tokenContractId: 1, delegate: 1, status: 1 });

// Methods
delegationSchema.methods.canMint = function (amount) {
  const mintedBN = BigInt(this.minted);
  const limitBN = BigInt(this.limit);
  const amountBN = BigInt(amount);
  return this.status === 'active' && mintedBN + amountBN <= limitBN;
};

delegationSchema.methods.getRemainingLimit = function () {
  const mintedBN = BigInt(this.minted);
  const limitBN = BigInt(this.limit);
  return (limitBN - mintedBN).toString();
};

delegationSchema.methods.getUsagePercentage = function () {
  const mintedBN = BigInt(this.minted);
  const limitBN = BigInt(this.limit);
  if (limitBN === 0n) return 0;
  return Number((mintedBN * 100n) / limitBN);
};

delegationSchema.methods.revoke = function () {
  this.status = 'revoked';
  this.revokedAt = new Date();
  return this.save();
};

delegationSchema.methods.updateMinted = function (newMinted) {
  this.minted = newMinted;
  this.lastMintedAt = new Date();
  this.totalMintCount += 1;
  
  // Mark as exhausted if limit reached
  if (BigInt(newMinted) >= BigInt(this.limit)) {
    this.status = 'exhausted';
  }
  
  return this.save();
};

// Statics
delegationSchema.statics.findByTokenAndOwner = function (tokenContractId, owner) {
  return this.find({ tokenContractId, owner, status: 'active' });
};

delegationSchema.statics.findByTokenAndDelegate = function (tokenContractId, delegate) {
  return this.find({ tokenContractId, delegate, status: 'active' });
};

delegationSchema.statics.findByTokenOwnerDelegate = function (tokenContractId, owner, delegate) {
  return this.findOne({ tokenContractId, owner, delegate });
};

module.exports = mongoose.model('Delegation', delegationSchema);
