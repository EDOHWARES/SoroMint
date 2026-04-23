'use strict';

const mongoose = require('mongoose');
const Proposal = require('../models/Proposal');
const Vote = require('../models/Vote');
const Token = require('../models/Token');
const { logger } = require('../utils/logger');

/**
 * @title Off-Chain Voting Service
 * @author SoroMint Team
 * @notice Implements Snapshot-style token-weighted governance polling.
 *         All data is stored in MongoDB — no gas fees, no on-chain transactions.
 *
 * @dev Voting power model:
 *   - For a proposal scoped to a specific contractId:
 *       power = 1  if the voter owns that exact token contract, else 0
 *   - For a general proposal (contractId = null):
 *       power = number of distinct token contracts owned by the voter
 *         in the SoroMint Token collection (each deployment = 1 unit)
 *   - Minimum power enforced: voters with 0 power are rejected unless
 *     ALLOW_ZERO_POWER_VOTES is set (useful for testing).
 *
 * Snapshot semantics:
 *   The power is calculated at vote-cast time against the live Token
 *   collection.  For a true historical snapshot, integrate with a Horizon
 *   archive endpoint or record a ledger sequence in proposal.snapshotTime.
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Allow voters with 0 tokens to still cast a vote (test / demo mode). */
const ALLOW_ZERO_POWER_VOTES = process.env.ALLOW_ZERO_POWER_VOTES === 'true';

/** Minimum voting power required to cast a vote (unless overridden above). */
const MIN_VOTING_POWER = 0;

// ---------------------------------------------------------------------------
// Voting Power
// ---------------------------------------------------------------------------

/**
 * @notice Calculates the voting power for a given wallet address.
 *
 * @param {string} publicKey - Voter's Stellar G-address (normalised to uppercase)
 * @param {string|null} [contractId=null] - If set, checks ownership of this
 *   specific contract; otherwise counts all tokens the voter owns.
 * @returns {Promise<number>} Non-negative integer voting power.
 *
 * @example
 *   // General proposal
 *   await getVotingPower('GABC...');            // → 3  (owns 3 token contracts)
 *   // Contract-scoped proposal
 *   await getVotingPower('GABC...', 'CXYZ...'); // → 1 or 0
 */
const getVotingPower = async (publicKey, contractId = null) => {
  const voter = publicKey.toUpperCase();

  if (contractId) {
    // Scoped: binary — does the voter own this specific token?
    const count = await Token.countDocuments({
      ownerPublicKey: voter,
      contractId,
    });
    return count > 0 ? 1 : 0;
  }

  // General: total number of distinct token contracts owned by this voter
  const count = await Token.countDocuments({ ownerPublicKey: voter });
  return count;
};

// ---------------------------------------------------------------------------
// Proposal CRUD
// ---------------------------------------------------------------------------

/**
 * @notice Creates and persists a new governance proposal.
 *
 * @param {object} params
 * @param {string}   params.title         - Proposal title (3-200 chars)
 * @param {string}   params.description   - Full description (10-10000 chars)
 * @param {string}   params.creator       - G-address of the creating wallet
 * @param {string[]} params.choices       - 2-10 voting options
 * @param {Date}     params.startTime     - When voting opens
 * @param {Date}     params.endTime       - When voting closes
 * @param {string|null} [params.contractId=null]     - Token scope (optional)
 * @param {Date|null}   [params.snapshotTime=null]   - Override snapshot time
 * @param {string[]}    [params.tags=[]]             - Optional freeform tags
 * @param {string|null} [params.discussionUrl=null]  - Link to discussion
 *
 * @returns {Promise<Proposal>} The saved Mongoose document.
 */
const createProposal = async ({
  title,
  description,
  creator,
  choices,
  startTime,
  endTime,
  contractId = null,
  snapshotTime = null,
  tags = [],
  discussionUrl = null,
}) => {
  const proposal = new Proposal({
    title: title.trim(),
    description: description.trim(),
    creator: creator.toUpperCase(),
    choices: choices.map((c) => c.trim()),
    startTime: new Date(startTime),
    endTime: new Date(endTime),
    contractId: contractId || null,
    snapshotTime: snapshotTime ? new Date(snapshotTime) : null,
    tags: tags.map((t) => t.trim()).filter(Boolean),
    discussionUrl: discussionUrl || null,
  });

  // Derive initial status from times
  proposal.syncStatus();

  await proposal.save();

  logger.info('[Voting] Proposal created', {
    proposalId: proposal._id,
    creator: proposal.creator,
    title: proposal.title,
    status: proposal.status,
  });

  return proposal;
};

/**
 * @notice Retrieves a single proposal by ID, optionally syncing its status.
 *
 * @param {string} proposalId - MongoDB ObjectId string
 * @param {boolean} [syncStatus=true] - Whether to persist a status update
 * @returns {Promise<Proposal>}
 * @throws {Error} If the proposal is not found
 */
const getProposal = async (proposalId, syncStatus = true) => {
  const proposal = await Proposal.findById(proposalId);
  if (!proposal) {
    const err = new Error('Proposal not found');
    err.statusCode = 404;
    err.code = 'PROPOSAL_NOT_FOUND';
    throw err;
  }

  if (syncStatus) {
    const before = proposal.status;
    proposal.syncStatus();
    if (proposal.status !== before) {
      await proposal.save();
    }
  }

  return proposal;
};

/**
 * @notice Lists proposals with optional filtering and pagination.
 *
 * @param {object} [opts={}]
 * @param {string}   [opts.status]      - Filter by status (pending/active/closed/cancelled)
 * @param {string}   [opts.contractId]  - Filter by token scope
 * @param {string}   [opts.creator]     - Filter by creator G-address
 * @param {number}   [opts.page=1]
 * @param {number}   [opts.limit=20]
 * @param {boolean}  [opts.syncStatuses=true] - Run a bulk status sync first
 *
 * @returns {Promise<{
 *   proposals: Proposal[],
 *   totalCount: number,
 *   page: number,
 *   totalPages: number,
 *   limit: number
 * }>}
 */
const listProposals = async ({
  status,
  contractId,
  creator,
  page = 1,
  limit = 20,
  syncStatuses = true,
} = {}) => {
  // Run a lightweight bulk sync so callers always see fresh statuses
  if (syncStatuses) {
    try {
      await Proposal.syncAllStatuses();
    } catch (err) {
      // Non-fatal — continue even if sync fails
      logger.warn('[Voting] Status sync failed during list', { error: err.message });
    }
  }

  const filter = {};
  if (status)     filter.status     = status;
  if (contractId) filter.contractId = contractId;
  if (creator)    filter.creator    = creator.toUpperCase();

  const skip = (page - 1) * limit;

  const [proposals, totalCount] = await Promise.all([
    Proposal.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit),
    Proposal.countDocuments(filter),
  ]);

  return {
    proposals,
    totalCount,
    page,
    totalPages: Math.ceil(totalCount / limit),
    limit,
  };
};

/**
 * @notice Updates a proposal's editable fields.
 *         Only the creator can edit, and only while the proposal is pending.
 *
 * @param {string} proposalId  - MongoDB ObjectId string
 * @param {string} editorKey   - G-address of the wallet requesting the update
 * @param {object} updates     - Fields to update (title, description, endTime,
 *                               tags, discussionUrl)
 * @returns {Promise<Proposal>}
 * @throws {Error} 403 if not the creator; 409 if not pending
 */
const updateProposal = async (proposalId, editorKey, updates) => {
  const proposal = await getProposal(proposalId, true);

  if (proposal.creator !== editorKey.toUpperCase()) {
    const err = new Error('Only the proposal creator can edit this proposal');
    err.statusCode = 403;
    err.code = 'FORBIDDEN';
    throw err;
  }

  if (proposal.status !== 'pending') {
    const err = new Error(
      `Cannot edit a proposal that is ${proposal.status}. Only pending proposals can be edited.`
    );
    err.statusCode = 409;
    err.code = 'PROPOSAL_NOT_EDITABLE';
    throw err;
  }

  const allowedFields = ['title', 'description', 'endTime', 'tags', 'discussionUrl'];
  for (const field of allowedFields) {
    if (updates[field] !== undefined) {
      proposal[field] = updates[field];
    }
  }

  await proposal.save();

  logger.info('[Voting] Proposal updated', { proposalId, editorKey });
  return proposal;
};

/**
 * @notice Cancels a proposal.
 *         Only the creator can cancel; already-closed proposals cannot be cancelled.
 *
 * @param {string} proposalId  - MongoDB ObjectId string
 * @param {string} cancellerKey - G-address of the cancelling wallet
 * @returns {Promise<Proposal>}
 */
const cancelProposal = async (proposalId, cancellerKey) => {
  const proposal = await getProposal(proposalId, true);

  if (proposal.creator !== cancellerKey.toUpperCase()) {
    const err = new Error('Only the proposal creator can cancel this proposal');
    err.statusCode = 403;
    err.code = 'FORBIDDEN';
    throw err;
  }

  if (proposal.status === 'closed') {
    const err = new Error('Cannot cancel a proposal that has already closed');
    err.statusCode = 409;
    err.code = 'PROPOSAL_ALREADY_CLOSED';
    throw err;
  }

  if (proposal.status === 'cancelled') {
    const err = new Error('Proposal is already cancelled');
    err.statusCode = 409;
    err.code = 'PROPOSAL_ALREADY_CANCELLED';
    throw err;
  }

  proposal.status = 'cancelled';
  await proposal.save();

  logger.info('[Voting] Proposal cancelled', { proposalId, cancellerKey });
  return proposal;
};

// ---------------------------------------------------------------------------
// Voting
// ---------------------------------------------------------------------------

/**
 * @notice Casts a vote on a proposal.
 *
 * Checks performed (in order):
 *   1. Proposal exists and its status is synced.
 *   2. Voting window is currently open.
 *   3. Voter has not already voted on this proposal.
 *   4. choice index is valid (within proposal.choices bounds).
 *   5. Voter has sufficient voting power (>= 1 unless ALLOW_ZERO_POWER_VOTES).
 *
 * On success:
 *   - Persists a Vote document.
 *   - Atomically updates the Proposal's denormalised tally counters.
 *
 * @param {object} params
 * @param {string} params.proposalId   - MongoDB ObjectId string
 * @param {string} params.voter        - Voter's Stellar G-address
 * @param {number} params.choice       - 0-based index into proposal.choices
 * @param {string} [params.signedMessage] - Optional Freighter-signed message
 *
 * @returns {Promise<{ vote: Vote, proposal: Proposal, votingPower: number }>}
 */
const castVote = async ({ proposalId, voter, choice, signedMessage = null }) => {
  const voterKey = voter.toUpperCase();

  // ── 1. Load & sync proposal ────────────────────────────────────────────────
  const proposal = await getProposal(proposalId, true);

  // ── 2. Voting window check ─────────────────────────────────────────────────
  if (!proposal.isVotingOpen) {
    const err = new Error(
      `Voting is not open for this proposal (status: ${proposal.status})`
    );
    err.statusCode = 409;
    err.code = 'VOTING_NOT_OPEN';
    throw err;
  }

  // ── 3. Duplicate-vote check ────────────────────────────────────────────────
  const alreadyVoted = await Vote.hasVoted(proposalId, voterKey);
  if (alreadyVoted) {
    const err = new Error('You have already voted on this proposal');
    err.statusCode = 409;
    err.code = 'ALREADY_VOTED';
    throw err;
  }

  // ── 4. Validate choice index ───────────────────────────────────────────────
  const choiceIndex = parseInt(choice, 10);
  if (
    !Number.isInteger(choiceIndex) ||
    choiceIndex < 0 ||
    choiceIndex >= proposal.choices.length
  ) {
    const err = new Error(
      `Invalid choice index ${choice}. Valid range: 0–${proposal.choices.length - 1}`
    );
    err.statusCode = 400;
    err.code = 'INVALID_CHOICE';
    throw err;
  }

  // ── 5. Calculate voting power ──────────────────────────────────────────────
  const votingPower = await getVotingPower(voterKey, proposal.contractId);

  if (!ALLOW_ZERO_POWER_VOTES && votingPower <= MIN_VOTING_POWER) {
    const scope = proposal.contractId
      ? `token contract ${proposal.contractId}`
      : 'any token on SoroMint';
    const err = new Error(
      `You have no voting power for this proposal. ` +
      `You must own ${scope} to participate.`
    );
    err.statusCode = 403;
    err.code = 'INSUFFICIENT_VOTING_POWER';
    throw err;
  }

  // ── Persist vote + update tally atomically ─────────────────────────────────
  const session = await mongoose.startSession();
  let savedVote;
  let updatedProposal;

  try {
    await session.withTransaction(async () => {
      // Create the Vote document
      const [vote] = await Vote.create(
        [
          {
            proposalId: proposal._id,
            voter: voterKey,
            choice: choiceIndex,
            votingPower,
            signedMessage: signedMessage || null,
          },
        ],
        { session }
      );
      savedVote = vote;

      // Update the denormalised tally on the Proposal
      updatedProposal = await Proposal.findByIdAndUpdate(
        proposal._id,
        {
          $inc: {
            voteCount: 1,
            totalVotingPower: votingPower,
            [`tally.${choiceIndex}.totalPower`]: votingPower,
            [`tally.${choiceIndex}.voteCount`]: 1,
          },
        },
        { new: true, session }
      );
    });
  } finally {
    await session.endSession();
  }

  logger.info('[Voting] Vote cast', {
    proposalId,
    voter: voterKey,
    choice: choiceIndex,
    choiceLabel: proposal.choices[choiceIndex],
    votingPower,
  });

  return { vote: savedVote, proposal: updatedProposal, votingPower };
};

// ---------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------

/**
 * @notice Returns the full results for a proposal, including per-choice
 *         vote counts, total voting power, and percentage breakdowns.
 *
 * @param {string} proposalId
 * @returns {Promise<{
 *   proposal: Proposal,
 *   results: Array<{
 *     index: number,
 *     label: string,
 *     voteCount: number,
 *     totalPower: number,
 *     percentage: number   // share of total voting power (0-100)
 *   }>,
 *   totalVotingPower: number,
 *   totalVoteCount: number,
 *   winningChoice: { index: number, label: string } | null
 * }>}
 */
const getResults = async (proposalId) => {
  const proposal = await getProposal(proposalId, true);

  // Re-aggregate from Vote documents for accuracy (tally is denormalised
  // for fast reads but the aggregate is authoritative).
  const tallies = await Vote.getTallies(proposalId);

  // Build a map for O(1) lookups
  const tallyMap = {};
  for (const t of tallies) {
    tallyMap[t.choice] = t;
  }

  const totalVotingPower = tallies.reduce((sum, t) => sum + t.totalPower, 0);
  const totalVoteCount   = tallies.reduce((sum, t) => sum + t.voteCount, 0);

  const results = proposal.choices.map((label, index) => {
    const t = tallyMap[index] || { voteCount: 0, totalPower: 0 };
    const percentage =
      totalVotingPower > 0
        ? parseFloat(((t.totalPower / totalVotingPower) * 100).toFixed(2))
        : 0;
    return {
      index,
      label,
      voteCount: t.voteCount,
      totalPower: t.totalPower,
      percentage,
    };
  });

  // Determine winner (highest total power); null if tie or no votes
  let winningChoice = null;
  if (totalVotingPower > 0) {
    const sorted = [...results].sort((a, b) => b.totalPower - a.totalPower);
    if (sorted[0].totalPower > (sorted[1]?.totalPower ?? 0)) {
      winningChoice = { index: sorted[0].index, label: sorted[0].label };
    }
  }

  return {
    proposal,
    results,
    totalVotingPower,
    totalVoteCount,
    winningChoice,
  };
};

// ---------------------------------------------------------------------------
// Vote listing
// ---------------------------------------------------------------------------

/**
 * @notice Lists individual votes for a proposal (paginated).
 *
 * @param {string} proposalId
 * @param {object} [opts]
 * @param {number} [opts.page=1]
 * @param {number} [opts.limit=50]
 * @returns {Promise<{
 *   votes: Vote[],
 *   totalCount: number,
 *   page: number,
 *   totalPages: number,
 *   limit: number
 * }>}
 */
const listVotes = async (proposalId, { page = 1, limit = 50 } = {}) => {
  // Verify proposal exists
  await getProposal(proposalId, false);

  const skip = (page - 1) * limit;

  const [votes, totalCount] = await Promise.all([
    Vote.find({ proposalId })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    Vote.countDocuments({ proposalId }),
  ]);

  return {
    votes,
    totalCount,
    page,
    totalPages: Math.ceil(totalCount / limit),
    limit,
  };
};

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  getVotingPower,
  createProposal,
  getProposal,
  listProposals,
  updateProposal,
  cancelProposal,
  castVote,
  getResults,
  listVotes,
};
