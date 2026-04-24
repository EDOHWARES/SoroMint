const mongoose = require('mongoose');

/**
 * @title Token Schema
 * @description MongoDB schema for Soroban tokens on the Stellar network
 * @notice Stores metadata for tokens created through the SoroMint platform
 * @dev Used to track token ownership and configuration on Stellar
 */

/**
 * @typedef {Object} Token
 * @property {string} _id - MongoDB ObjectId
 * @property {string} name - Full name of the token (e.g., "SoroMint Token")
 * @property {string} symbol - Token symbol/ticker (e.g., "SORO")
 * @property {number} decimals - Number of decimal places (default: 7)
 * @property {string} contractId - Stellar contract address (C... format)
 * @property {string} ownerPublicKey - Owner's Stellar public key (G... format)
 * @property {Date} createdAt - Token creation timestamp
 */

const TokenSchema = new mongoose.Schema({
  /**
   * @property {string} name - Full name of the token
   * @required
   * @example "SoroMint Token"
   */
  name: {
    type: String,
    required: true,
  },
  /**
   * @property {string} symbol - Token symbol/ticker
   * @required
   * @example "SORO"
   */
  symbol: {
    type: String,
    required: true,
  },
  /**
   * @property {number} decimals - Number of decimal places for token amounts
   * @default 7
   * @example 7
   */
  decimals: {
    type: Number,
    default: 7,
  },
  /**
   * @property {string} contractId - Stellar smart contract address
   * @required
   * @unique
   * @example "CA3D5KRYM6CB7OWQ6TWYRR3Z4T7GNZLKERYNZGGA5SOAOPIFY6YQGAXE"
   */
  contractId: {
    type: String,
    required: true,
    unique: true,
  },
  /**
   * @property {string} ownerPublicKey - Stellar public key of the token owner
   * @required
   * @example "GBZ4XGQW5X6V7Y2Z3A4B5C6D7E8F9G0H1I2J3K4L5M6N7O8P9Q0R1S2T"
   */
  ownerPublicKey: {
    type: String,
    required: true,
  },
  /**
   * @property {string} description - Token description for metadata
   * @example "This is my custom token"
   */
  description: {
    type: String,
  },
  /**
   * @property {string} ipfsIconCid - IPFS CID for the token icon image
   * @example "bafybeigdyr..."
   */
  ipfsIconCid: {
    type: String,
  },
  /**
   * @property {string} ipfsMetadataCid - IPFS CID for the token JSON metadata
   * @example "bafkreifh2..."
   */
  ipfsMetadataCid: {
    type: String,
  },
  /**
   * @property {Date} createdAt - Timestamp of token record creation
   * @default Date.now
   */
  createdAt: {
    type: Date,
    default: Date.now,
  }
});

/**
 * @type {mongoose.Model<Token>}
 */
module.exports = mongoose.model('Token', TokenSchema);
