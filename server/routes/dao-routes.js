'use strict';

const express = require('express');
const { asyncHandler } = require('../middleware/error-handler');
const { authenticate } = require('../middleware/auth');
const { logger } = require('../utils/logger');
const {
  createProposal,
  castVote,
  getProposal,
  getProposalsByToken,
  getVotesByProposal,
} = require('../services/dao-service');
const {
  validateProposal,
  validateVote,
  validateProposalId,
  validateTokenQuery,
} = require('../validators/dao-validator');

const router = express.Router();

/**
 * @openapi
 * @route POST /api/dao/proposals
 * @name createProposal
 * @description Create a new DAO governance proposal
 * @tags Voting
 * @security BearerAuth
 * @param {string} tokenId - Token ID associated with the proposal
 * @param {string} contractId - Contract ID (optional)
 * @param {string} proposer - Proposer's public key
 * @param {object} changes - Proposed changes
 * @param {number} quorum - Quorum threshold
 * @param {number} durationDays - Voting duration in days
 * @returns {object} 201 - Created proposal
 */
router.post(
  '/proposals',
  authenticate,
  validateProposal,
  asyncHandler(async (req, res) => {
    const { tokenId, contractId, proposer, changes, quorum, durationDays } = req.body;

    logger.info('Creating proposal', {
      correlationId: req.correlationId,
      tokenId,
      proposer,
    });

    const proposal = await createProposal({
      tokenId,
      contractId,
      proposer,
      changes,
      quorum,
      durationDays,
    });

    res.status(201).json({ success: true, data: proposal });
  })
);

/**
 * @openapi
 * @route POST /api/dao/votes
 * @name castVote
 * @description Cast a vote on a DAO proposal
 * @tags Voting
 * @security BearerAuth
 * @param {string} proposalId - Proposal ID to vote on
 * @param {string} voter - Voter's public key
 * @param {boolean} support - Whether the voter supports the proposal
 * @returns {object} 201 - Cast vote
 */
router.post(
  '/votes',
  authenticate,
  validateVote,
  asyncHandler(async (req, res) => {
    const { proposalId, voter, support } = req.body;

    logger.info('Casting vote', {
      correlationId: req.correlationId,
      proposalId,
      voter,
      support,
    });

    const vote = await castVote({ proposalId, voter, support });

    res.status(201).json({ success: true, data: vote });
  })
);

/**
 * @openapi
 * @route GET /api/dao/proposals/{proposalId}
 * @name getProposal
 * @description Get details of a specific DAO proposal
 * @tags Voting
 * @security BearerAuth
 * @param {string} proposalId - Proposal ID
 * @returns {object} 200 - Proposal details
 */
router.get(
  '/proposals/:proposalId',
  authenticate,
  validateProposalId,
  asyncHandler(async (req, res) => {
    const { proposalId } = req.params;

    const proposal = await getProposal(proposalId);

    res.json({ success: true, data: proposal });
  })
);

/**
 * @openapi
 * @route GET /api/dao/proposals
 * @name getProposalsByToken
 * @description Get all DAO proposals for a specific token with optional status filter
 * @tags Voting
 * @security BearerAuth
 * @param {string} tokenId - Token ID to filter proposals
 * @param {string} status - Filter by status (optional)
 * @returns {array} 200 - Array of proposals
 */
router.get(
  '/proposals',
  authenticate,
  validateTokenQuery,
  asyncHandler(async (req, res) => {
    const { tokenId, status } = req.query;

    const proposals = await getProposalsByToken(tokenId, status);

    res.json({ success: true, data: proposals });
  })
);

/**
 * @openapi
 * @route GET /api/dao/proposals/{proposalId}/votes
 * @name getVotesByProposal
 * @description Get all votes cast for a specific DAO proposal
 * @tags Voting
 * @security BearerAuth
 * @param {string} proposalId - Proposal ID
 * @returns {array} 200 - Array of votes
 */
router.get(
  '/proposals/:proposalId/votes',
  authenticate,
  validateProposalId,
  asyncHandler(async (req, res) => {
    const { proposalId } = req.params;

    const votes = await getVotesByProposal(proposalId);

    res.json({ success: true, data: votes });
  })
);

module.exports = router;
