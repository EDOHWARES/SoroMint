'use strict';

const express = require('express');
const { authenticate } = require('../middleware/auth');
const { asyncHandler, AppError } = require('../middleware/error-handler');
const { logger } = require('../utils/logger');
const {
  validateCreateProposal,
  validateUpdateProposal,
  validateCastVote,
  validateListProposalsQuery,
  validateListVotesQuery,
} = require('../validators/voting-validator');
const {
  getVotingPower,
  createProposal,
  getProposal,
  listProposals,
  updateProposal,
  cancelProposal,
  castVote,
  getResults,
  listVotes,
} = require('../services/voting-service');

/**
 * @title Voting Routes
 * @author SoroMint Team
 * @notice Express router for the off-chain Snapshot-style governance system.
 *
 * @dev All mutating routes (POST/PATCH/DELETE) require a valid JWT obtained
 *      via the SEP-10 challenge-response auth flow.  Read-only routes
 *      (GET) are public so anyone can browse proposals and results.
 *
 * Route map:
 *   GET    /api/proposals                     — list proposals (public)
 *   POST   /api/proposals                     — create proposal (auth)
 *   GET    /api/proposals/:id                 — get single proposal (public)
 *   PATCH  /api/proposals/:id                 — update proposal  (auth, creator)
 *   POST   /api/proposals/:id/cancel          — cancel proposal  (auth, creator)
 *   POST   /api/proposals/:id/votes           — cast a vote      (auth)
 *   GET    /api/proposals/:id/votes           — list votes       (public)
 *   GET    /api/proposals/:id/results         — tally results    (public)
 *   GET    /api/voting-power                  — my voting power  (auth)
 *   GET    /api/voting-power/:publicKey       — any key's power  (public)
 */
const createVotingRouter = () => {
  const router = express.Router();

  // =========================================================================
  // GET /api/proposals
  // =========================================================================

  /**
   * @route  GET /api/proposals
   * @desc   List proposals with optional filters and pagination.
   * @access Public
   *
   * @query {string}  [status=all]       — pending | active | closed | cancelled | all
   * @query {string}  [contractId]       — filter by token contract scope
   * @query {string}  [creator]          — filter by creator G-address
   * @query {string}  [search]           — full-text search on title/description
   * @query {string}  [tags]             — comma-separated tag filter
   * @query {number}  [page=1]
   * @query {number}  [limit=20]
   * @query {string}  [sortBy=createdAt] — createdAt | startTime | endTime | voteCount | totalVotingPower
   * @query {string}  [sortOrder=desc]   — asc | desc
   *
   * @returns 200 { success, data: proposals[], metadata }
   */
  router.get(
    '/proposals',
    validateListProposalsQuery,
    asyncHandler(async (req, res) => {
      const {
        status,
        contractId,
        creator,
        search,
        tags,
        page,
        limit,
        sortBy,
        sortOrder,
      } = req.query;

      logger.info('[Voting] List proposals', {
        correlationId: req.correlationId,
        status,
        page,
        limit,
      });

      // Build query options — pass to service (search/tags handled below)
      const result = await listProposals({
        status: status === 'all' ? undefined : status,
        contractId,
        creator,
        search,
        tags,
        page,
        limit,
        sortBy,
        sortOrder,
        syncStatuses: true,
      });

      res.json({
        success: true,
        data: result.proposals,
        metadata: {
          totalCount: result.totalCount,
          page: result.page,
          totalPages: result.totalPages,
          limit: result.limit,
        },
      });
    })
  );

  // =========================================================================
  // POST /api/proposals
  // =========================================================================

  /**
   * @route  POST /api/proposals
   * @desc   Create a new governance proposal.
   * @access Private (JWT required)
   *
   * @body {string}   title          — 3-200 chars
   * @body {string}   description    — 10-10000 chars (Markdown)
   * @body {string[]} choices        — 2-10 voting options
   * @body {string}   startTime      — ISO 8601 datetime (future)
   * @body {string}   endTime        — ISO 8601 datetime (after startTime, min 1h, max 90d)
   * @body {string}   [contractId]   — Stellar C-address (scopes voting power)
   * @body {string[]} [tags]         — up to 10 freeform tags
   * @body {string}   [discussionUrl] — http(s) URL
   *
   * @returns 201 { success, data: proposal }
   */
  router.post(
    '/proposals',
    authenticate,
    validateCreateProposal,
    asyncHandler(async (req, res) => {
      // Enforce that the creator in the body matches the authenticated wallet
      const authenticatedKey = req.user.publicKey;

      const proposal = await createProposal({
        ...req.body,
        creator: authenticatedKey, // always use the JWT identity, not body input
      });

      logger.info('[Voting] Proposal created via API', {
        correlationId: req.correlationId,
        proposalId: proposal._id,
        creator: proposal.creator,
      });

      res.status(201).json({
        success: true,
        message: 'Proposal created successfully',
        data: proposal,
      });
    })
  );

  // =========================================================================
  // GET /api/proposals/:id
  // =========================================================================

  /**
   * @route  GET /api/proposals/:id
   * @desc   Fetch a single proposal document including its tally.
   *         Status is synced against wall-clock time before responding.
   * @access Public
   *
   * @returns 200 { success, data: proposal }
   * @returns 404 PROPOSAL_NOT_FOUND
   */
  router.get(
    '/proposals/:id',
    asyncHandler(async (req, res) => {
      const proposal = await getProposal(req.params.id, true);

      res.json({
        success: true,
        data: proposal,
      });
    })
  );

  // =========================================================================
  // PATCH /api/proposals/:id
  // =========================================================================

  /**
   * @route  PATCH /api/proposals/:id
   * @desc   Update a pending proposal (creator only).
   *         Allowed fields: title, description, choices, startTime, endTime,
   *                         tags, discussionUrl.
   *         Once voting has started (status = active) the proposal is locked.
   * @access Private (JWT required, creator only)
   *
   * @returns 200 { success, data: updated proposal }
   * @returns 403 FORBIDDEN          (not the creator)
   * @returns 409 PROPOSAL_NOT_EDITABLE (status ≠ pending)
   */
  router.patch(
    '/proposals/:id',
    authenticate,
    validateUpdateProposal,
    asyncHandler(async (req, res) => {
      const updated = await updateProposal(
        req.params.id,
        req.user.publicKey,
        req.body
      );

      res.json({
        success: true,
        message: 'Proposal updated successfully',
        data: updated,
      });
    })
  );

  // =========================================================================
  // POST /api/proposals/:id/cancel
  // =========================================================================

  /**
   * @route  POST /api/proposals/:id/cancel
   * @desc   Cancel a proposal (creator only).
   *         Pending and active proposals can be cancelled; closed ones cannot.
   * @access Private (JWT required, creator only)
   *
   * @returns 200 { success, data: cancelled proposal }
   * @returns 403 FORBIDDEN
   * @returns 409 PROPOSAL_ALREADY_CLOSED | PROPOSAL_ALREADY_CANCELLED
   */
  router.post(
    '/proposals/:id/cancel',
    authenticate,
    asyncHandler(async (req, res) => {
      const cancelled = await cancelProposal(req.params.id, req.user.publicKey);

      res.json({
        success: true,
        message: 'Proposal cancelled successfully',
        data: cancelled,
      });
    })
  );

  // =========================================================================
  // POST /api/proposals/:id/votes
  // =========================================================================

  /**
   * @route  POST /api/proposals/:id/votes
   * @desc   Cast a vote on an active proposal.
   *
   *   Voting power is determined by the number of token contracts the
   *   authenticated wallet owns in the SoroMint Token collection:
   *     • General proposal (contractId = null): power = total tokens owned
   *     • Contract-scoped proposal:             power = 1 if owner, else 0
   *
   *   Only one vote per wallet per proposal is allowed (replay-proof via
   *   the compound unique index on Vote.{proposalId, voter}).
   *
   * @access Private (JWT required)
   *
   * @body {number}  choice          — 0-based index into proposal.choices
   * @body {string}  [signedMessage] — Optional Freighter-signed message for auditability
   *
   * @returns 201 { success, data: { vote, proposal, votingPower } }
   * @returns 403 INSUFFICIENT_VOTING_POWER
   * @returns 409 ALREADY_VOTED | VOTING_NOT_OPEN
   */
  router.post(
    '/proposals/:id/votes',
    authenticate,
    validateCastVote,
    asyncHandler(async (req, res) => {
      const { choice, signedMessage } = req.body;
      const voter = req.user.publicKey;

      logger.info('[Voting] Vote cast attempt', {
        correlationId: req.correlationId,
        proposalId: req.params.id,
        voter,
        choice,
      });

      const result = await castVote({
        proposalId: req.params.id,
        voter,
        choice,
        signedMessage,
      });

      res.status(201).json({
        success: true,
        message: `Vote cast for "${result.proposal.choices[choice]}" with ${result.votingPower} voting power`,
        data: {
          vote: result.vote,
          votingPower: result.votingPower,
          choiceLabel: result.proposal.choices[choice],
          proposal: {
            id: result.proposal._id,
            title: result.proposal.title,
            voteCount: result.proposal.voteCount,
            totalVotingPower: result.proposal.totalVotingPower,
            tally: result.proposal.tally,
          },
        },
      });
    })
  );

  // =========================================================================
  // GET /api/proposals/:id/votes
  // =========================================================================

  /**
   * @route  GET /api/proposals/:id/votes
   * @desc   List individual votes for a proposal (paginated).
   * @access Public
   *
   * @query {number} [page=1]
   * @query {number} [limit=20]
   * @query {number} [choice]  — filter to a specific choice index
   *
   * @returns 200 { success, data: votes[], metadata }
   */
  router.get(
    '/proposals/:id/votes',
    validateListVotesQuery,
    asyncHandler(async (req, res) => {
      const { page, limit, choice } = req.query;

      const result = await listVotes(req.params.id, { page, limit, choice });

      res.json({
        success: true,
        data: result.votes,
        metadata: {
          totalCount: result.totalCount,
          page: result.page,
          totalPages: result.totalPages,
          limit: result.limit,
        },
      });
    })
  );

  // =========================================================================
  // GET /api/proposals/:id/results
  // =========================================================================

  /**
   * @route  GET /api/proposals/:id/results
   * @desc   Return authoritative vote tallies aggregated from the Vote
   *         collection.  Includes per-choice breakdown and overall winner.
   * @access Public
   *
   * @returns 200 {
   *   success,
   *   data: {
   *     proposal,
   *     results: [{ index, label, voteCount, totalPower, percentage }],
   *     totalVotingPower,
   *     totalVoteCount,
   *     winningChoice: { index, label } | null
   *   }
   * }
   */
  router.get(
    '/proposals/:id/results',
    asyncHandler(async (req, res) => {
      const results = await getResults(req.params.id);

      res.json({
        success: true,
        data: results,
      });
    })
  );

  // =========================================================================
  // GET /api/voting-power   (authenticated user's own power)
  // =========================================================================

  /**
   * @route  GET /api/voting-power
   * @desc   Return the voting power of the currently authenticated wallet.
   *
   * @access Private (JWT required)
   *
   * @query {string} [contractId] — optional C-address to scope the calculation
   *
   * @returns 200 { success, data: { publicKey, contractId, votingPower } }
   */
  router.get(
    '/voting-power',
    authenticate,
    asyncHandler(async (req, res) => {
      const publicKey = req.user.publicKey;
      const { contractId } = req.query;

      // Optional contractId validation
      if (contractId && !/^C[A-Z2-7]{55}$/.test(contractId)) {
        throw new AppError(
          'contractId must be a valid Stellar C-address (56 chars, starts with C)',
          400,
          'INVALID_CONTRACT_ID'
        );
      }

      const votingPower = await getVotingPower(publicKey, contractId || null);

      res.json({
        success: true,
        data: {
          publicKey,
          contractId: contractId || null,
          votingPower,
        },
      });
    })
  );

  // =========================================================================
  // GET /api/voting-power/:publicKey   (any wallet — public lookup)
  // =========================================================================

  /**
   * @route  GET /api/voting-power/:publicKey
   * @desc   Return the voting power of any Stellar wallet (public lookup).
   * @access Public
   *
   * @param  {string} publicKey  — Stellar G-address
   * @query  {string} [contractId] — optional C-address scope
   *
   * @returns 200 { success, data: { publicKey, contractId, votingPower } }
   * @returns 400 INVALID_PUBLIC_KEY
   */
  router.get(
    '/voting-power/:publicKey',
    asyncHandler(async (req, res) => {
      const { publicKey } = req.params;
      const { contractId } = req.query;

      // Validate G-address
      if (!/^G[A-Z2-7]{55}$/.test(publicKey)) {
        throw new AppError(
          'publicKey must be a valid Stellar G-address (56 chars, starts with G)',
          400,
          'INVALID_PUBLIC_KEY'
        );
      }

      // Optional contractId validation
      if (contractId && !/^C[A-Z2-7]{55}$/.test(contractId)) {
        throw new AppError(
          'contractId must be a valid Stellar C-address (56 chars, starts with C)',
          400,
          'INVALID_CONTRACT_ID'
        );
      }

      const votingPower = await getVotingPower(publicKey, contractId || null);

      res.json({
        success: true,
        data: {
          publicKey,
          contractId: contractId || null,
          votingPower,
        },
      });
    })
  );

  return router;
};

const votingRouter = createVotingRouter();

module.exports = votingRouter;
module.exports.createVotingRouter = createVotingRouter;
