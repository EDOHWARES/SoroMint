const request = require('supertest');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const MultiSigTransaction = require('../models/MultiSigTransaction');
const multiSigService = require('../services/multisig-service');

let mongoServer;

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri());
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

afterEach(async () => {
  await MultiSigTransaction.deleteMany({});
});

describe('MultiSigTransaction Model', () => {
  it('should create a multi-sig transaction', async () => {
    const tx = new MultiSigTransaction({
      txId: '1',
      multiSigContractId: 'C123',
      tokenContractId: 'C456',
      targetFunction: 'mint',
      functionArgs: { to: 'G...', amount: 1000 },
      proposer: 'G111',
      signatures: [{ signer: 'G111', signedAt: new Date() }],
      requiredSignatures: 2,
      status: 'pending',
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    });

    await tx.save();
    expect(tx._id).toBeDefined();
    expect(tx.status).toBe('pending');
  });

  it('should check if transaction can execute', () => {
    const tx = new MultiSigTransaction({
      txId: '1',
      multiSigContractId: 'C123',
      tokenContractId: 'C456',
      targetFunction: 'mint',
      functionArgs: {},
      proposer: 'G111',
      signatures: [
        { signer: 'G111', signedAt: new Date() },
        { signer: 'G222', signedAt: new Date() },
      ],
      requiredSignatures: 2,
      status: 'pending',
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    });

    expect(tx.canExecute()).toBe(true);
  });

  it('should not execute if threshold not met', () => {
    const tx = new MultiSigTransaction({
      txId: '1',
      multiSigContractId: 'C123',
      tokenContractId: 'C456',
      targetFunction: 'mint',
      functionArgs: {},
      proposer: 'G111',
      signatures: [{ signer: 'G111', signedAt: new Date() }],
      requiredSignatures: 2,
      status: 'pending',
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    });

    expect(tx.canExecute()).toBe(false);
  });

  it('should check if signer has signed', () => {
    const tx = new MultiSigTransaction({
      txId: '1',
      multiSigContractId: 'C123',
      tokenContractId: 'C456',
      targetFunction: 'mint',
      functionArgs: {},
      proposer: 'G111',
      signatures: [{ signer: 'G111', signedAt: new Date() }],
      requiredSignatures: 2,
      status: 'pending',
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    });

    expect(tx.hasSignedBy('G111')).toBe(true);
    expect(tx.hasSignedBy('G222')).toBe(false);
  });

  it('should not execute if expired', () => {
    const tx = new MultiSigTransaction({
      txId: '1',
      multiSigContractId: 'C123',
      tokenContractId: 'C456',
      targetFunction: 'mint',
      functionArgs: {},
      proposer: 'G111',
      signatures: [
        { signer: 'G111', signedAt: new Date() },
        { signer: 'G222', signedAt: new Date() },
      ],
      requiredSignatures: 2,
      status: 'pending',
      expiresAt: new Date(Date.now() - 1000), // Expired
    });

    expect(tx.canExecute()).toBe(false);
  });
});

describe('MultiSigService', () => {
  it('should encode function arguments', () => {
    const args = { to: 'G...', amount: 1000 };
    const encoded = multiSigService.encodeArgs(args);
    expect(encoded).toBeInstanceOf(Buffer);
    expect(JSON.parse(encoded.toString())).toEqual(args);
  });
});
