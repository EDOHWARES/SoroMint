const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const { createProposal, castVote, getProposal, getProposalsByToken } = require('../../services/dao-service');
const Proposal = require('../../models/Proposal');
const Vote = require('../../models/Vote');
const Token = require('../../models/Token');
const { AppError } = require('../../middleware/error-handler');

jest.mock('../../services/stellar-service', () => ({
  getRpcServer: jest.fn(() => ({
    execute: jest.fn((fn) => fn({
      getAccount: jest.fn(() => Promise.resolve({ sequence: '123' })),
      simulateTransaction: jest.fn(() => Promise.resolve({ success: true })),
    })),
  })),
}));

describe('DAO Service', () => {
  let mongoServer;
  let testToken;

  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    const mongoUri = mongoServer.getUri();
    await mongoose.connect(mongoUri);
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await mongoServer.stop();
  });

  beforeEach(async () => {
    await Proposal.deleteMany({});
    await Vote.deleteMany({});
    await Token.deleteMany({});

    testToken = await Token.create({
      name: 'Test Token',
      symbol: 'TEST',
      decimals: 7,
      contractId: 'CTEST123',
      ownerPublicKey: 'GTEST123',
    });
  });

  describe('createProposal', () => {
    it('should create a proposal successfully', async () => {
      const proposalData = {
        tokenId: testToken._id,
        contractId: testToken.contractId,
        proposer: 'GPROPOSER123',
        changes: { name: 'New Name', symbol: 'NEW' },
        quorum: 60,
        durationDays: 5,
      };

      const proposal = await createProposal(proposalData);

      expect(proposal).toBeDefined();
      expect(proposal.tokenId.toString()).toBe(testToken._id.toString());
      expect(proposal.changes.name).toBe('New Name');
      expect(proposal.quorum).toBe(60);
      expect(proposal.status).toBe('ACTIVE');
    });

    it('should throw error for non-existent token', async () => {
      const proposalData = {
        tokenId: new mongoose.Types.ObjectId(),
        contractId: 'CTEST123',
        proposer: 'GPROPOSER123',
        changes: { name: 'New Name' },
      };

      await expect(createProposal(proposalData)).rejects.toThrow(AppError);
    });
  });

  describe('castVote', () => {
    let testProposal;

    beforeEach(async () => {
      testProposal = await Proposal.create({
        tokenId: testToken._id,
        contractId: testToken.contractId,
        proposer: 'GPROPOSER123',
        changes: { name: 'New Name' },
        quorum: 51,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      });
    });

    it('should cast a vote successfully', async () => {
      const voteData = {
        proposalId: testProposal._id,
        voter: 'GVOTER123',
        support: true,
      };

      const vote = await castVote(voteData);

      expect(vote).toBeDefined();
      expect(vote.support).toBe(true);

      const updatedProposal = await Proposal.findById(testProposal._id);
      expect(updatedProposal.votesFor).toBe(1);
    });

    it('should prevent duplicate votes', async () => {
      const voteData = {
        proposalId: testProposal._id,
        voter: 'GVOTER123',
        support: true,
      };

      await castVote(voteData);

      await expect(castVote(voteData)).rejects.toThrow('Already voted');
    });

    it('should reject vote on expired proposal', async () => {
      testProposal.expiresAt = new Date(Date.now() - 1000);
      await testProposal.save();

      const voteData = {
        proposalId: testProposal._id,
        voter: 'GVOTER123',
        support: true,
      };

      await expect(castVote(voteData)).rejects.toThrow('expired');
    });
  });

  describe('getProposal', () => {
    it('should retrieve a proposal by ID', async () => {
      const proposal = await Proposal.create({
        tokenId: testToken._id,
        contractId: testToken.contractId,
        proposer: 'GPROPOSER123',
        changes: { name: 'New Name' },
        quorum: 51,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      });

      const retrieved = await getProposal(proposal._id);

      expect(retrieved).toBeDefined();
      expect(retrieved._id.toString()).toBe(proposal._id.toString());
    });

    it('should throw error for non-existent proposal', async () => {
      await expect(getProposal(new mongoose.Types.ObjectId())).rejects.toThrow(AppError);
    });
  });

  describe('getProposalsByToken', () => {
    it('should retrieve all proposals for a token', async () => {
      await Proposal.create({
        tokenId: testToken._id,
        contractId: testToken.contractId,
        proposer: 'GPROPOSER123',
        changes: { name: 'Name 1' },
        quorum: 51,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      });

      await Proposal.create({
        tokenId: testToken._id,
        contractId: testToken.contractId,
        proposer: 'GPROPOSER456',
        changes: { name: 'Name 2' },
        quorum: 51,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      });

      const proposals = await getProposalsByToken(testToken._id);

      expect(proposals).toHaveLength(2);
    });

    it('should filter proposals by status', async () => {
      await Proposal.create({
        tokenId: testToken._id,
        contractId: testToken.contractId,
        proposer: 'GPROPOSER123',
        changes: { name: 'Name 1' },
        quorum: 51,
        status: 'ACTIVE',
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      });

      await Proposal.create({
        tokenId: testToken._id,
        contractId: testToken.contractId,
        proposer: 'GPROPOSER456',
        changes: { name: 'Name 2' },
        quorum: 51,
        status: 'EXECUTED',
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      });

      const activeProposals = await getProposalsByToken(testToken._id, 'ACTIVE');

      expect(activeProposals).toHaveLength(1);
      expect(activeProposals[0].status).toBe('ACTIVE');
    });
  });
});
