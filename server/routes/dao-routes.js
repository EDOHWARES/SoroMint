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
