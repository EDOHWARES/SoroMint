const mongoose = require('mongoose');

const VoteSchema = new mongoose.Schema({
  proposalId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Proposal',
    required: true,
  },
  voter: {
    type: String,
    required: true,
  },
  support: {
    type: Boolean,
    required: true,
  },
  weight: {
    type: Number,
    default: 1,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

VoteSchema.index({ proposalId: 1, voter: 1 }, { unique: true });

module.exports = mongoose.model('Vote', VoteSchema);
