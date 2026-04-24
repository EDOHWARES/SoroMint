const Proposal = require('../models/Proposal');
const Vote = require('../models/Vote');
const Token = require('../models/Token');
const { AppError } = require('../middleware/error-handler');
const { logger } = require('../utils/logger');
const { getRpcServer } = require('./stellar-service');
const { Contract, Address, nativeToScVal, TransactionBuilder } = require('@stellar/stellar-sdk');
const { getEnv } = require('../config/env-config');

const createProposal = async ({ tokenId, contractId, proposer, changes, quorum = 51, durationDays = 7 }) => {
  const token = await Token.findById(tokenId);
  if (!token) {
    throw new AppError('Token not found', 404, 'TOKEN_NOT_FOUND');
  }

  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + durationDays);

  const proposal = await Proposal.create({
    tokenId,
    contractId,
    proposer,
    changes,
    quorum,
    expiresAt,
  });

  logger.info('Proposal created', { proposalId: proposal._id, tokenId, proposer });
  return proposal;
};

const castVote = async ({ proposalId, voter, support }) => {
  const proposal = await Proposal.findById(proposalId);
  if (!proposal) {
    throw new AppError('Proposal not found', 404, 'PROPOSAL_NOT_FOUND');
  }

  if (proposal.status !== 'ACTIVE') {
    throw new AppError('Proposal is not active', 400, 'PROPOSAL_NOT_ACTIVE');
  }

  if (new Date() > proposal.expiresAt) {
    proposal.status = 'EXPIRED';
    await proposal.save();
    throw new AppError('Proposal has expired', 400, 'PROPOSAL_EXPIRED');
  }

  const existingVote = await Vote.findOne({ proposalId, voter });
  if (existingVote) {
    throw new AppError('Already voted', 400, 'ALREADY_VOTED');
  }

  const vote = await Vote.create({ proposalId, voter, support, weight: 1 });

  if (support) {
    proposal.votesFor += vote.weight;
  } else {
    proposal.votesAgainst += vote.weight;
  }
  await proposal.save();

  logger.info('Vote cast', { proposalId, voter, support });

  await checkAndExecuteProposal(proposal);

  return vote;
};

const checkAndExecuteProposal = async (proposal) => {
  const totalVotes = proposal.votesFor + proposal.votesAgainst;
  if (totalVotes === 0) return;

  const approvalRate = (proposal.votesFor / totalVotes) * 100;

  if (approvalRate >= proposal.quorum && totalVotes >= 3) {
    await executeProposal(proposal);
  }
};

const executeProposal = async (proposal) => {
  if (proposal.status !== 'ACTIVE') {
    throw new AppError('Proposal cannot be executed', 400, 'INVALID_STATUS');
  }

  try {
    const token = await Token.findById(proposal.tokenId);
    if (!token) {
      throw new AppError('Token not found', 404, 'TOKEN_NOT_FOUND');
    }

    const server = getRpcServer();
    const env = getEnv();
    const contract = new Contract(proposal.contractId);

    const account = await server.execute((s) => s.getAccount(proposal.proposer));
    const txBuilder = new TransactionBuilder(account, {
      fee: '100000',
      networkPassphrase: env.NETWORK_PASSPHRASE,
    });

    if (proposal.changes.name) {
      const nameOp = contract.call(
        'set_name',
        nativeToScVal(proposal.changes.name, { type: 'string' })
      );
      txBuilder.addOperation(nameOp);
    }

    if (proposal.changes.symbol) {
      const symbolOp = contract.call(
        'set_symbol',
        nativeToScVal(proposal.changes.symbol, { type: 'string' })
      );
      txBuilder.addOperation(symbolOp);
    }

    const tx = txBuilder.setTimeout(30).build();
    const simulation = await server.execute((s) => s.simulateTransaction(tx));

    if (simulation.error) {
      throw new Error(`Simulation failed: ${simulation.error}`);
    }

    proposal.status = 'EXECUTED';
    proposal.executedAt = new Date();
    proposal.executionTxHash = 'simulated';
    await proposal.save();

    if (proposal.changes.name) token.name = proposal.changes.name;
    if (proposal.changes.symbol) token.symbol = proposal.changes.symbol;
    await token.save();

    logger.info('Proposal executed', { proposalId: proposal._id });
  } catch (error) {
    logger.error('Proposal execution failed', { proposalId: proposal._id, error: error.message });
    proposal.status = 'REJECTED';
    await proposal.save();
    throw error;
  }
};

const getProposal = async (proposalId) => {
  const proposal = await Proposal.findById(proposalId).populate('tokenId');
  if (!proposal) {
    throw new AppError('Proposal not found', 404, 'PROPOSAL_NOT_FOUND');
  }
  return proposal;
};

const getProposalsByToken = async (tokenId, status = null) => {
  const query = { tokenId };
  if (status) query.status = status;
  return Proposal.find(query).sort({ createdAt: -1 });
};

const getVotesByProposal = async (proposalId) => {
  return Vote.find({ proposalId }).sort({ createdAt: -1 });
};

module.exports = {
  createProposal,
  castVote,
  executeProposal,
  getProposal,
  getProposalsByToken,
  getVotesByProposal,
};
