'use strict';

const mongoose = require('mongoose');

/**
 * @title Vote Model
 * @author SoroMint Team
 * @notice Stores individual off-chain votes cast against governance proposals.
 *         Each (proposalId, voter) pair is unique — one wallet, one vote.
 *
 * @dev Voting power is snapshotted and stored at the time the vote is cast.
 *      The compound unique index on (proposalId, voter) is the primary guard
 *      against double-voting; the voting-service layer enforces it at the
 *      application level as well for cleaner error messages.
 */

const VoteSchema = new mongoose.Schema(
  {
    /**
     * @property {ObjectId} proposalId - Reference to the parent Proposal document.
     * @required
     */
    proposalId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Proposal',
      required: [true, 'proposalId is required'],
      index: true,
    },

    /**
     * @property {string} voter - Stellar G-address of the wallet that cast the vote.
     * @required
     */
    voter: {
      type: String,
      required: [true, 'voter public key is required'],
      trim: true,
      validate: {
        validator: (v) => /^G[A-Z2-7]{55}$/.test(v),
        message: 'voter must be a valid Stellar G-address (56 characters, starts with G)',
      },
    },

    /**
     * @property {number} choice - Zero-based index into the parent proposal's
     *   `choices` array (e.g. 0 = "Yes", 1 = "No", 2 = "Abstain").
     * @required
     * @min 0
     */
    choice: {
      type: Number,
      required: [true, 'choice index is required'],
      min: [0, 'choice must be a non-negative integer'],
      validate: {
        validator: Number.isInteger,
        message: 'choice must be an integer',
      },
    },

    /**
     * @property {number} votingPower - Token-weighted voting power recorded at
     *   the moment this vote was cast.  Equals the number of token contracts
     *   owned by the voter in the SoroMint system (or 1 for contract-specific
     *   proposals where the voter simply holds the relevant token).
     * @required
     * @min 0
     */
    votingPower: {
      type: Number,
      required: [true, 'votingPower is required'],
      min: [0, 'votingPower cannot be negative'],
    },

    /**
     * @property {string} [signedMessage] - Optional Freighter-signed message
     *   that proves the voter controls the wallet at the time of voting.
     *   Stored as a base64-encoded XDR or raw hex signature string.
     *   Not required for MVP but enables future on-chain auditability.
     */
    signedMessage: {
      type: String,
      default: null,
    },
  },
  {
    timestamps: true, // adds createdAt & updatedAt automatically
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// Indexes
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Compound unique index — one vote per wallet per proposal.
 * The database layer will throw a duplicate-key error (code 11000) if a
 * second vote is attempted; the service layer catches this and converts it
 * to a user-friendly AppError.
 */
VoteSchema.index({ proposalId: 1, voter: 1 }, { unique: true });

/**
 * Index for quickly aggregating results for a proposal, ordered by choice.
 */
VoteSchema.index({ proposalId: 1, choice: 1 });

/**
 * Index for looking up all votes cast by a specific wallet.
 */
VoteSchema.index({ voter: 1, createdAt: -1 });

// ─────────────────────────────────────────────────────────────────────────────
// Static helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @notice Aggregate votes for a given proposal into per-choice tallies.
 * @param {string|ObjectId} proposalId
 * @returns {Promise<Array<{ choice: number, voteCount: number, totalPower: number }>>}
 */
VoteSchema.statics.getTallies = function (proposalId) {
  return this.aggregate([
    { $match: { proposalId: new mongoose.Types.ObjectId(String(proposalId)) } },
    {
      $group: {
        _id: '$choice',
        voteCount: { $sum: 1 },
        totalPower: { $sum: '$votingPower' },
      },
    },
    {
      $project: {
        _id: 0,
        choice: '$_id',
        voteCount: 1,
        totalPower: 1,
      },
    },
    { $sort: { choice: 1 } },
  ]);
};

/**
 * @notice Check whether a specific voter has already voted on a proposal.
 * @param {string|ObjectId} proposalId
 * @param {string} voter - Stellar G-address
 * @returns {Promise<boolean>}
 */
VoteSchema.statics.hasVoted = async function (proposalId, voter) {
  const count = await this.countDocuments({ proposalId, voter: voter.toUpperCase() });
  return count > 0;
};

/**
 * @notice Find the vote cast by a specific voter on a specific proposal.
 * @param {string|ObjectId} proposalId
 * @param {string} voter - Stellar G-address
 * @returns {Promise<Vote|null>}
 */
VoteSchema.statics.findByProposalAndVoter = function (proposalId, voter) {
  return this.findOne({ proposalId, voter: voter.toUpperCase() });
};

module.exports = mongoose.model('Vote', VoteSchema);
