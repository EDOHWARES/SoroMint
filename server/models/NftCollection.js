const mongoose = require('mongoose');

const NftCollectionSchema = new mongoose.Schema({
  name: { type: String, required: true },
  symbol: { type: String, required: true },
  contractId: { type: String, required: true, unique: true },
  ownerPublicKey: { type: String, required: true },
  totalMinted: { type: Number, default: 0 },
  createdAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model('NftCollection', NftCollectionSchema);
