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

const createVotingRouter = () => {
  const router = express.Router();

  /**
   * @openapi
   * @route GET /api/proposals
   * @name listProposals
   * @description List governance proposals with optional filters and pagination
   * @tags Voting
   * @param {string} status - Filter by status: pending, active, closed, cancelled, all (optional)
   * @param {string} contractId - Filter by token contract scope (optional)
   * @param {string} creator - Filter by creator G-address (optional)
   * @param {string} search - Full-text search on title/description (optional)
   * @param {string} tags - Comma-separated tag filter (optional)
   * @param {integer} page - Page number (optional, default: 1)
   * @param {integer} limit - Results per page (optional, default: 20)
   * @param {string} sortBy - Sort field: createdAt, startTime, endTime, voteCount, totalVotingPower (optional)
   * @param {string} sortOrder - Sort order: asc or desc (optional, default: desc)
   * @returns {object} 200 - Proposals with pagination metadata
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

  /**
   * @openapi
   * @route POST /api/proposals
   * @name createProposal
   * @description Create a new governance proposal
   * @tags Voting
   * @security BearerAuth
   * @param {string} title - Proposal title (3-200 chars)
   * @param {string} description - Proposal description in Markdown (10-10000 chars)
   * @param {string[]} choices - Voting options (2-10 choices)
   * @param {string} startTime - ISO 8601 datetime for voting start (must be in future)
   * @param {string} endTime - ISO 8601 datetime for voting end (min 1h after start, max 90d)
   * @param {string} contractId - Stellar C-address for voting power scope (optional)
   * @param {string[]} tags - Freeform tags (up to 10)
   * @param {string} discussionUrl - Link to discussion forum (optional)
   * @returns {object} 201 - Proposal created successfully
   * @returns {object} 400 - Validation error
   * @returns {object} 401 - Unauthorized
   */
  router.post(
    '/proposals',
    authenticate,
    validateCreateProposal,
    asyncHandler(async (req, res) => {
      const authenticatedKey = req.user.publicKey;

      const proposal = await createProposal({
        ...req.body,
        creator: authenticatedKey,
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

  /**
   * @openapi
   * @route GET /api/proposals/{id}
   * @name getProposal
   * @description Fetch a single proposal including its tally (status synced against wall-clock)
   * @tags Voting
   * @param {string} id - Proposal ID
   * @returns {object} 200 - Proposal data
   * @returns {object} 404 - Proposal not found
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

  /**
   * @openapi
   * @route PATCH /api/proposals/{id}
   * @name updateProposal
   * @description Update a pending proposal (creator only). Voting cannot start yet.
   * @tags Voting
   * @security BearerAuth
   * @param {string} id - Proposal ID
   * @param {string} title - New title (optional)
   * @param {string} description - New description (optional)
   * @param {string[]} choices - New voting options (optional)
   * @param {string} startTime - New start datetime (optional)
   * @param {string} endTime - New end datetime (optional)
   * @param {string[]} tags - New tags (optional)
   * @param {string} discussionUrl - New discussion URL (optional)
   * @returns {object} 200 - Updated proposal
   * @returns {object} 403 - Not the creator
   * @returns {object} 409 - Proposal not editable (voting already started)
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

  /**
   * @openapi
   * @route POST /api/proposals/{id}/cancel
   * @name cancelProposal
   * @description Cancel a pending or active proposal (creator only)
   * @tags Voting
   * @security BearerAuth
   * @param {string} id - Proposal ID
   * @returns {object} 200 - Cancelled proposal
   * @returns {object} 403 - Not the creator
   * @returns {object} 409 - Already closed or cancelled
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

  /**
   * @openapi
   * @route POST /api/proposals/{id}/votes
   * @name castVote
   * @description Cast a vote on an active proposal
   * @tags Voting
   * @security BearerAuth
   * @param {string} id - Proposal ID
   * @param {integer} choice - 0-based index into proposal choices
   * @param {string} signedMessage - Optional Freighter-signed message for auditability
   * @returns {object} 201 - Vote cast successfully
   * @returns {object} 403 - Insufficient voting power
   * @returns {object} 409 - Already voted or voting not open
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

  /**
   * @openapi
   * @route GET /api/proposals/{id}/votes
   * @name listVotes
   * @description List individual votes for a proposal (paginated)
   * @tags Voting
   * @param {string} id - Proposal ID
   * @param {integer} page - Page number (optional, default: 1)
   * @param {integer} limit - Results per page (optional, default: 20)
   * @param {integer} choice - Filter by specific choice index (optional)
   * @returns {object} 200 - Votes with pagination metadata
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

  /**
   * @openapi
   * @route GET /api/proposals/{id}/results
   * @name getProposalResults
   * @description Return authoritative vote tallies with per-choice breakdown and winner
   * @tags Voting
   * @param {string} id - Proposal ID
   * @returns {object} 200 - Vote tallies and results
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

  /**
   * @openapi
   * @route GET /api/voting-power
   * @name getMyVotingPower
   * @description Get the voting power of the currently authenticated wallet
   * @tags Voting
   * @security BearerAuth
   * @param {string} contractId - Optional C-address to scope the calculation
   * @returns {object} 200 - Voting power data
   */
  router.get(
    '/voting-power',
    authenticate,
    asyncHandler(async (req, res) => {
      const publicKey = req.user.publicKey;
      const { contractId } = req.query;

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

  /**
   * @openapi
   * @route GET /api/voting-power/{publicKey}
   * @name getVotingPowerByKey
   * @description Get the voting power of any Stellar wallet (public lookup)
   * @tags Voting
   * @param {string} publicKey - Stellar G-address
   * @param {string} contractId - Optional C-address scope
   * @returns {object} 200 - Voting power data
   * @returns {object} 400 - Invalid public key
   */
  router.get(
    '/voting-power/:publicKey',
    asyncHandler(async (req, res) => {
      const { publicKey } = req.params;
      const { contractId } = req.query;

      if (!/^G[A-Z2-7]{55}$/.test(publicKey)) {
        throw new AppError(
          'publicKey must be a valid Stellar G-address (56 chars, starts with G)',
          400,
          'INVALID_PUBLIC_KEY'
        );
      }

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
