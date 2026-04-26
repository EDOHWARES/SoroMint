const User = require('../models/User');
const Referral = require('../models/Referral');
const { logger } = require('../utils/logger');

/**
 * @notice Calculate referral reward amount
 * @dev Currently fixed at 5% of the mint amount
 * @param {number} amount - The amount being minted
 * @returns {number} The reward amount
 */
const calculateReward = (amount) => {
  return amount * 0.05;
};

/**
 * @notice Get referral stats for a user
 * @param {string} userId - The user's MongoDB ID
 * @returns {Promise<Object>} Stats including total referrals and rewards
 */
const getReferralStats = async (userId) => {
  const [referralCount, totalRewards] = await Promise.all([
    User.countDocuments({ referredBy: userId }),
    Referral.aggregate([
      { $match: { referrerId: userId } },
      { $group: { _id: null, total: { $sum: '$rewardAmount' } } },
    ]),
  ]);

  return {
    referralCount,
    totalRewards: totalRewards.length > 0 ? totalRewards[0].total : 0,
  };
};

/**
 * @notice Get referral history for a user
 * @param {string} userId - The user's MongoDB ID
 * @returns {Promise<Array>} List of referral rewards
 */
const getReferralHistory = async (userId) => {
  return Referral.find({ referrerId: userId })
    .populate('referredUserId', 'username publicKey')
    .sort({ createdAt: -1 });
};

module.exports = {
  calculateReward,
  getReferralStats,
  getReferralHistory,
};
