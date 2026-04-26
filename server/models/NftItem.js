const mongoose = require('mongoose');

const NftItemSchema = new mongoose.Schema({
  tokenId: { type: Number, required: true },
  uri: { type: String, required: true },
  collectionId: { type: mongoose.Schema.Types.ObjectId, ref: 'NftCollection', required: true },
  contractId: { type: String, required: true },
  ownerPublicKey: { type: String, required: true },
  createdAt: { type: Date, default: Date.now },
});

// Ensure uniqueness of tokenId within a collection contract
NftItemSchema.index({ contractId: 1, tokenId: 1 }, { unique: true });

module.exports = mongoose.model('NftItem', NftItemSchema);
