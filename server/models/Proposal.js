const mongoose = require('mongoose');

const ProposalSchema = new mongoose.Schema({
  tokenId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Token',
    required: true,
  },
  contractId: {
    type: String,
    required: true,
  },
  proposer: {
    type: String,
    required: true,
  },
  type: {
    type: String,
    enum: ['METADATA_UPDATE'],
    default: 'METADATA_UPDATE',
  },
  changes: {
    name: String,
    symbol: String,
  },
  status: {
    type: String,
    enum: ['PENDING', 'ACTIVE', 'EXECUTED', 'REJECTED', 'EXPIRED'],
    default: 'ACTIVE',
  },
  votesFor: {
    type: Number,
    default: 0,
  },
  votesAgainst: {
    type: Number,
    default: 0,
  },
  quorum: {
    type: Number,
    required: true,
    default: 51,
  },
  expiresAt: {
    type: Date,
    required: true,
  },
  executedAt: Date,
  executionTxHash: String,
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

ProposalSchema.index({ tokenId: 1, status: 1 });
ProposalSchema.index({ contractId: 1 });
ProposalSchema.index({ expiresAt: 1 });

module.exports = mongoose.model('Proposal', ProposalSchema);
