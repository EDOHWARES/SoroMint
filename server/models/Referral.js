const mongoose = require('mongoose');

/**
 * @title Referral Reward Model
 * @notice Stores history of rewards earned by referrers
 */

const ReferralSchema = new mongoose.Schema({
  /**
   * User who earned the reward
   */
  referrerId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  /**
   * User whose action triggered the reward
   */
  referredUserId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  /**
   * Amount of reward tokens (in decimal format)
   */
  rewardAmount: {
    type: Number,
    required: true
  },
  /**
   * Token contract ID
   */
  contractId: {
    type: String,
    required: true
  },
  /**
   * Transaction hash of the on-chain reward minting
   */
  txHash: {
    type: String,
    required: true,
    unique: true
  },
  /**
   * Type of operation that triggered the reward (e.g., 'mint')
   */
  operationType: {
    type: String,
    default: 'mint'
  },
  /**
   * When the reward was processed
   */
  createdAt: {
    type: Date,
    default: Date.now
  }
});

module.exports = mongoose.model('Referral', ReferralSchema);
