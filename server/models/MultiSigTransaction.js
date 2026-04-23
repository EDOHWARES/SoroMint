const mongoose = require('mongoose');

const MultiSigTransactionSchema = new mongoose.Schema({
  txId: {
    type: String,
    required: true,
    unique: true,
  },
  multiSigContractId: {
    type: String,
    required: true,
    index: true,
  },
  tokenContractId: {
    type: String,
    required: true,
  },
  targetFunction: {
    type: String,
    required: true,
    enum: ['mint', 'burn', 'transfer_ownership', 'set_fee_config', 'pause', 'unpause'],
  },
  functionArgs: {
    type: mongoose.Schema.Types.Mixed,
    required: true,
  },
  proposer: {
    type: String,
    required: true,
  },
  signatures: [{
    signer: String,
    signedAt: Date,
    signature: String,
  }],
  requiredSignatures: {
    type: Number,
    required: true,
  },
  status: {
    type: String,
    enum: ['pending', 'approved', 'executed', 'rejected'],
    default: 'pending',
  },
  executedAt: Date,
  executedBy: String,
  executionTxHash: String,
  createdAt: {
    type: Date,
    default: Date.now,
  },
  expiresAt: {
    type: Date,
    required: true,
  },
}, {
  timestamps: true
});

MultiSigTransactionSchema.index({ status: 1, expiresAt: 1 });
MultiSigTransactionSchema.index({ multiSigContractId: 1, status: 1 });

MultiSigTransactionSchema.methods.canExecute = function() {
  return this.signatures.length >= this.requiredSignatures && 
         this.status === 'pending' &&
         new Date() < this.expiresAt;
};

MultiSigTransactionSchema.methods.hasSignedBy = function(signerAddress) {
  return this.signatures.some(sig => sig.signer === signerAddress);
};

module.exports = mongoose.model('MultiSigTransaction', MultiSigTransactionSchema);
