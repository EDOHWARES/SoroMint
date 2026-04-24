const mongoose = require('mongoose');

const SorobanEventSchema = new mongoose.Schema({
  contractId: { type: String, required: true, index: true },
  eventType: { type: String, required: true, index: true },
  ledger: { type: Number, required: true, index: true },
  ledgerClosedAt: { type: Date, required: true, index: true },
  txHash: { type: String, required: true, index: true },
  topics: [{ type: String }],
  value: { type: mongoose.Schema.Types.Mixed },
  pagingToken: { type: String, unique: true, required: true },
  inSuccessfulContractCall: { type: Boolean, default: true },
}, { timestamps: true });

SorobanEventSchema.index({ contractId: 1, ledger: -1 });
SorobanEventSchema.index({ eventType: 1, ledgerClosedAt: -1 });
SorobanEventSchema.index({ contractId: 1, eventType: 1, ledgerClosedAt: -1 });

module.exports = mongoose.model('SorobanEvent', SorobanEventSchema);
