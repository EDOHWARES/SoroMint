'use strict';

const mongoose = require('mongoose');

/**
 * @title Proposal Model
 * @author SoroMint Team
 * @notice Stores off-chain governance proposals for Snapshot-style token-weighted voting.
 *
 * @dev Status machine:
 *   pending  → active   (when Date.now() >= startTime)
 *   active   → closed   (when Date.now() >= endTime)
 *   pending  → cancelled (creator cancels before voting starts)
 *   active   → cancelled (creator cancels during voting — uncommon but allowed)
 *
 * Voting power is determined by the voter's token holdings recorded in the
 * SoroMint Token collection at the time the vote is cast (or at snapshotTime
 * if explicitly set). No on-chain transactions are required.
 */

// ---------------------------------------------------------------------------
// Sub-schemas
// ---------------------------------------------------------------------------

/**
 * Denormalised per-choice tally stored on the proposal document.
 * Updated atomically each time a vote is cast or changed.
 */
const ChoiceTallySchema = new mongoose.Schema(
  {
    /** 0-based index matching the position in proposal.choices[] */
    index: { type: Number, required: true },
    /** Human-readable label copied from proposal.choices[index] */
    label: { type: String, required: true },
    /** Sum of votingPower for all votes on this choice */
    totalPower: { type: Number, default: 0, min: 0 },
    /** Raw count of distinct wallets that picked this choice */
    voteCount: { type: Number, default: 0, min: 0 },
  },
  { _id: false }
);

// ---------------------------------------------------------------------------
// Main schema
// ---------------------------------------------------------------------------

const ProposalSchema = new mongoose.Schema(
  {
    /**
     * Short, human-readable title.
     * @example "Increase max token symbol length to 20 characters"
     */
    title: {
      type: String,
      required: [true, 'Proposal title is required'],
      trim: true,
      minlength: [3, 'Title must be at least 3 characters'],
      maxlength: [200, 'Title must not exceed 200 characters'],
    },

    /**
     * Full description / body of the proposal (Markdown supported).
     */
    description: {
      type: String,
      required: [true, 'Proposal description is required'],
      trim: true,
      minlength: [10, 'Description must be at least 10 characters'],
      maxlength: [10000, 'Description must not exceed 10000 characters'],
    },

    /**
     * Stellar G-address of the wallet that created this proposal.
     */
    creator: {
      type: String,
      required: [true, 'Creator public key is required'],
      trim: true,
      validate: {
        validator: (v) => /^G[A-Z2-7]{55}$/.test(v),
        message: 'creator must be a valid Stellar G-address',
      },
    },

    /**
     * Optional: scopes this proposal to a specific Soroban token contract.
     * When set, voting power is computed only from holdings of that contract.
     * When null, all tokens owned by the voter across the platform contribute.
     */
    contractId: {
      type: String,
      default: null,
      trim: true,
      validate: {
        validator: (v) => v === null || /^C[A-Z2-7]{55}$/.test(v),
        message: 'contractId must be a valid Stellar C-address or null',
      },
    },

    /**
     * Ordered list of voting options.
     * Voters reference choices by 0-based index.
     * @example ["Yes", "No", "Abstain"]
     */
    choices: {
      type: [String],
      required: [true, 'At least 2 choices are required'],
      validate: [
        {
          validator: (arr) => Array.isArray(arr) && arr.length >= 2,
          message: 'A proposal must have at least 2 choices',
        },
        {
          validator: (arr) => arr.length <= 10,
          message: 'A proposal may have at most 10 choices',
        },
        {
          validator: (arr) => arr.every((c) => typeof c === 'string' && c.trim().length >= 1),
          message: 'Each choice must be a non-empty string',
        },
        {
          validator: (arr) => arr.every((c) => c.trim().length <= 100),
          message: 'Each choice must not exceed 100 characters',
        },
      ],
    },

    /**
     * When the voting window opens (inclusive).
     * Proposals with startTime in the future are in "pending" status.
     */
    startTime: {
      type: Date,
      required: [true, 'startTime is required'],
    },

    /**
     * When the voting window closes (exclusive).
     * Must be strictly after startTime.
     */
    endTime: {
      type: Date,
      required: [true, 'endTime is required'],
    },

    /**
     * Lifecycle status of the proposal.
     *
     *   pending   — created, voting not yet open
     *   active    — voting is currently open
     *   closed    — voting period has ended (results are final)
     *   cancelled — creator cancelled; no further voting allowed
     */
    status: {
      type: String,
      enum: {
        values: ['pending', 'active', 'closed', 'cancelled'],
        message: '{VALUE} is not a valid proposal status',
      },
      default: 'pending',
      index: true,
    },

    /**
     * The point-in-time used to determine voting power.
     * Defaults to the proposal's startTime when not explicitly provided.
     * Stored here so future integrations can resolve on-chain balances at
     * a specific ledger sequence / timestamp.
     */
    snapshotTime: {
      type: Date,
      default: null,
    },

    /**
     * Denormalised tally per choice — kept in sync by the voting service.
     * Populated once choices are set; rebuilt by voting-service when needed.
     */
    tally: {
      type: [ChoiceTallySchema],
      default: [],
    },

    /**
     * Total number of distinct wallets that have voted.
     * Denormalised for fast display without aggregation.
     */
    voteCount: {
      type: Number,
      default: 0,
      min: 0,
    },

    /**
     * Sum of all voting power across all votes.
     * Denormalised to avoid aggregation on every read.
     */
    totalVotingPower: {
      type: Number,
      default: 0,
      min: 0,
    },

    /**
     * Optional freeform tags for UI filtering (e.g. ["governance", "fees"]).
     */
    tags: {
      type: [String],
      default: [],
      validate: {
        validator: (arr) => arr.length <= 10,
        message: 'A proposal may have at most 10 tags',
      },
    },

    /**
     * Optional URL to off-chain discussion (e.g. forum post, Discord thread).
     */
    discussionUrl: {
      type: String,
      default: null,
      trim: true,
      validate: {
        validator: (v) => v === null || /^https?:\/\/.+/.test(v),
        message: 'discussionUrl must be a valid http(s) URL or null',
      },
    },
  },
  {
    timestamps: true, // createdAt + updatedAt managed by Mongoose
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// ---------------------------------------------------------------------------
// Indexes
// ---------------------------------------------------------------------------

/** Fast lookup by status (e.g. "all active proposals") */
ProposalSchema.index({ status: 1, createdAt: -1 });

/** Fast lookup by creator */
ProposalSchema.index({ creator: 1, createdAt: -1 });

/** Scoped proposals for a specific contract */
ProposalSchema.index({ contractId: 1, status: 1 });

/** Time-range queries for status sync */
ProposalSchema.index({ startTime: 1, endTime: 1, status: 1 });

// ---------------------------------------------------------------------------
// Virtuals
// ---------------------------------------------------------------------------

/**
 * Derived status based on current wall-clock time.
 * Useful for display when the stored status hasn't been synced yet.
 */
ProposalSchema.virtual('computedStatus').get(function () {
  if (this.status === 'cancelled') return 'cancelled';
  const now = new Date();
  if (now < this.startTime) return 'pending';
  if (now >= this.startTime && now < this.endTime) return 'active';
  return 'closed';
});

/**
 * True while voting is currently allowed.
 */
ProposalSchema.virtual('isVotingOpen').get(function () {
  const now = new Date();
  return (
    this.status !== 'cancelled' &&
    now >= this.startTime &&
    now < this.endTime
  );
});

/**
 * Remaining milliseconds until the voting window closes.
 * 0 when already closed or cancelled.
 */
ProposalSchema.virtual('timeRemainingMs').get(function () {
  if (this.status === 'cancelled' || this.status === 'closed') return 0;
  const remaining = this.endTime.getTime() - Date.now();
  return remaining > 0 ? remaining : 0;
});

// ---------------------------------------------------------------------------
// Instance methods
// ---------------------------------------------------------------------------

/**
 * @notice Resolves and stores the status from the current wall-clock time.
 *         Does NOT save — call proposal.save() after this if persistence is needed.
 * @returns {string} The newly resolved status
 */
ProposalSchema.methods.syncStatus = function () {
  if (this.status === 'cancelled') return this.status;

  const now = new Date();
  if (now < this.startTime) {
    this.status = 'pending';
  } else if (now >= this.startTime && now < this.endTime) {
    this.status = 'active';
  } else {
    this.status = 'closed';
  }

  return this.status;
};

/**
 * @notice Initialises the tally array from the choices list.
 *         Resets all counts to zero. Called once on creation.
 */
ProposalSchema.methods.initTally = function () {
  this.tally = this.choices.map((label, index) => ({
    index,
    label: label.trim(),
    totalPower: 0,
    voteCount: 0,
  }));
};

/**
 * @notice Applies a new vote to the denormalised tally.
 * @param {number} choiceIndex   - 0-based index of the chosen option
 * @param {number} votingPower   - Weight of this vote
 */
ProposalSchema.methods.applyVote = function (choiceIndex, votingPower) {
  const entry = this.tally.find((t) => t.index === choiceIndex);
  if (!entry) {
    throw new Error(`Invalid choice index: ${choiceIndex}`);
  }
  entry.totalPower = (entry.totalPower || 0) + votingPower;
  entry.voteCount = (entry.voteCount || 0) + 1;
  this.totalVotingPower = (this.totalVotingPower || 0) + votingPower;
  this.voteCount = (this.voteCount || 0) + 1;
};

/**
 * @notice Reverses a previously applied vote (used if a vote is retracted).
 * @param {number} choiceIndex   - 0-based index of the option that was chosen
 * @param {number} votingPower   - Weight of the vote being reversed
 */
ProposalSchema.methods.reverseVote = function (choiceIndex, votingPower) {
  const entry = this.tally.find((t) => t.index === choiceIndex);
  if (!entry) {
    throw new Error(`Invalid choice index: ${choiceIndex}`);
  }
  entry.totalPower = Math.max(0, (entry.totalPower || 0) - votingPower);
  entry.voteCount = Math.max(0, (entry.voteCount || 0) - 1);
  this.totalVotingPower = Math.max(0, (this.totalVotingPower || 0) - votingPower);
  this.voteCount = Math.max(0, (this.voteCount || 0) - 1);
};

// ---------------------------------------------------------------------------
// Static methods
// ---------------------------------------------------------------------------

/**
 * @notice Bulk-syncs proposal statuses based on the current time.
 *         Called periodically (e.g. by a cron job or on each list request).
 * @returns {Promise<{ pendingToActive: number, activeToClose: number }>}
 */
ProposalSchema.statics.syncAllStatuses = async function () {
  const now = new Date();

  const [pendingToActive, activeToClosed] = await Promise.all([
    // pending → active: startTime has passed, endTime not yet
    this.updateMany(
      { status: 'pending', startTime: { $lte: now }, endTime: { $gt: now } },
      { $set: { status: 'active' } }
    ),
    // active → closed: endTime has passed
    this.updateMany(
      { status: 'active', endTime: { $lte: now } },
      { $set: { status: 'closed' } }
    ),
  ]);

  return {
    pendingToActive: pendingToActive.modifiedCount,
    activeToClosed: activeToClosed.modifiedCount,
  };
};

/**
 * @notice Finds all proposals for a given creator.
 * @param {string} publicKey - Stellar G-address
 * @returns {Promise<Proposal[]>}
 */
ProposalSchema.statics.findByCreator = function (publicKey) {
  return this.find({ creator: publicKey }).sort({ createdAt: -1 });
};

// ---------------------------------------------------------------------------
// Pre-save hook
// ---------------------------------------------------------------------------

ProposalSchema.pre('save', function (next) {
  // Validate endTime > startTime
  if (this.endTime <= this.startTime) {
    return next(new Error('endTime must be after startTime'));
  }

  // Initialise snapshotTime to startTime if not set
  if (!this.snapshotTime) {
    this.snapshotTime = this.startTime;
  }

  // Initialise tally if empty (first save only)
  if (this.tally.length === 0 && this.choices.length > 0) {
    this.initTally();
  }

  next();
});

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

module.exports = mongoose.model('Proposal', ProposalSchema);
