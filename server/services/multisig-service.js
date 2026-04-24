const { Contract, nativeToScVal, xdr, Address } = require('@stellar/stellar-sdk');
const { getRpcServer } = require('./stellar-service');
const MultiSigTransaction = require('../models/MultiSigTransaction');
const { logger } = require('../utils/logger');

class MultiSigService {
  async proposeTransaction(multiSigContractId, tokenContractId, targetFunction, functionArgs, proposerPublicKey) {
    const rpcServer = getRpcServer();
    
    const contract = new Contract(multiSigContractId);
    const argsBuffer = this.encodeArgs(functionArgs);
    
    const txId = await rpcServer.execute(async (server) => {
      const result = await server.simulateTransaction(
        contract.call(
          'propose_tx',
          nativeToScVal(Address.fromString(proposerPublicKey), { type: 'address' }),
          nativeToScVal(Address.fromString(tokenContractId), { type: 'address' }),
          nativeToScVal(targetFunction, { type: 'symbol' }),
          nativeToScVal(argsBuffer, { type: 'bytes' })
        )
      );
      
      return this.extractTxIdFromResult(result);
    });

    const multiSigTx = new MultiSigTransaction({
      txId: txId.toString(),
      multiSigContractId,
      tokenContractId,
      targetFunction,
      functionArgs,
      proposer: proposerPublicKey,
      signatures: [{
        signer: proposerPublicKey,
        signedAt: new Date(),
      }],
      requiredSignatures: await this.getThreshold(multiSigContractId),
      status: 'pending',
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
    });

    await multiSigTx.save();

    logger.info('Multi-sig transaction proposed', {
      txId,
      multiSigContractId,
      tokenContractId,
      targetFunction,
      proposer: proposerPublicKey,
    });

    return multiSigTx;
  }

  async approveTransaction(txId, signerPublicKey) {
    const multiSigTx = await MultiSigTransaction.findOne({ txId });
    
    if (!multiSigTx) {
      throw new Error('Transaction not found');
    }

    if (multiSigTx.hasSignedBy(signerPublicKey)) {
      throw new Error('Already signed by this signer');
    }

    if (multiSigTx.status !== 'pending') {
      throw new Error(`Transaction is ${multiSigTx.status}`);
    }

    const rpcServer = getRpcServer();
    const contract = new Contract(multiSigTx.multiSigContractId);
    
    await rpcServer.execute(async (server) => {
      await server.simulateTransaction(
        contract.call(
          'approve_tx',
          nativeToScVal(Address.fromString(signerPublicKey), { type: 'address' }),
          nativeToScVal(parseInt(txId), { type: 'u64' })
        )
      );
    });

    multiSigTx.signatures.push({
      signer: signerPublicKey,
      signedAt: new Date(),
    });

    if (multiSigTx.signatures.length >= multiSigTx.requiredSignatures) {
      multiSigTx.status = 'approved';
    }

    await multiSigTx.save();

    logger.info('Multi-sig transaction approved', {
      txId,
      signer: signerPublicKey,
      currentSignatures: multiSigTx.signatures.length,
      requiredSignatures: multiSigTx.requiredSignatures,
    });

    return multiSigTx;
  }

  async executeTransaction(txId, executorPublicKey) {
    const multiSigTx = await MultiSigTransaction.findOne({ txId });
    
    if (!multiSigTx) {
      throw new Error('Transaction not found');
    }

    if (!multiSigTx.canExecute()) {
      throw new Error('Transaction cannot be executed');
    }

    const rpcServer = getRpcServer();
    const contract = new Contract(multiSigTx.multiSigContractId);
    
    const txHash = await rpcServer.execute(async (server) => {
      const result = await server.simulateTransaction(
        contract.call(
          'execute_tx',
          nativeToScVal(Address.fromString(executorPublicKey), { type: 'address' }),
          nativeToScVal(parseInt(txId), { type: 'u64' })
        )
      );
      
      return result.hash;
    });

    multiSigTx.status = 'executed';
    multiSigTx.executedAt = new Date();
    multiSigTx.executedBy = executorPublicKey;
    multiSigTx.executionTxHash = txHash;

    await multiSigTx.save();

    logger.info('Multi-sig transaction executed', {
      txId,
      executor: executorPublicKey,
      txHash,
    });

    return multiSigTx;
  }

  async getPendingTransactions(multiSigContractId) {
    return MultiSigTransaction.find({
      multiSigContractId,
      status: 'pending',
      expiresAt: { $gt: new Date() },
    }).sort({ createdAt: -1 });
  }

  async getTransaction(txId) {
    return MultiSigTransaction.findOne({ txId });
  }

  async getThreshold(multiSigContractId) {
    const rpcServer = getRpcServer();
    const contract = new Contract(multiSigContractId);
    
    return rpcServer.execute(async (server) => {
      const result = await server.simulateTransaction(
        contract.call('get_threshold')
      );
      
      return this.extractU32FromResult(result);
    });
  }

  async getSigners(multiSigContractId) {
    const rpcServer = getRpcServer();
    const contract = new Contract(multiSigContractId);
    
    return rpcServer.execute(async (server) => {
      const result = await server.simulateTransaction(
        contract.call('get_signers')
      );
      
      return this.extractAddressVecFromResult(result);
    });
  }

  encodeArgs(args) {
    return Buffer.from(JSON.stringify(args));
  }

  extractTxIdFromResult(result) {
    return 1; // Placeholder
  }

  extractU32FromResult(result) {
    return 2; // Placeholder
  }

  extractAddressVecFromResult(result) {
    return []; // Placeholder
  }
}

module.exports = new MultiSigService();
