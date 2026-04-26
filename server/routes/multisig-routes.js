const express = require('express');
const { asyncHandler, AppError } = require('../middleware/error-handler');
const { authenticate } = require('../middleware/auth');
const multiSigService = require('../services/multisig-service');
const { logger } = require('../utils/logger');
const { validateProposal, validateTxId, validateContractId } = require('../validators/multisig-validator');

const router = express.Router();

router.post('/propose', authenticate, validateProposal, asyncHandler(async (req, res) => {
  const { multiSigContractId, tokenContractId, targetFunction, functionArgs } = req.body;
  const proposerPublicKey = req.user.publicKey;

  if (!multiSigContractId || !tokenContractId || !targetFunction || !functionArgs) {
    throw new AppError('Missing required fields', 400, 'VALIDATION_ERROR');
  }

  const validFunctions = ['mint', 'burn', 'transfer_ownership', 'set_fee_config', 'pause', 'unpause'];
  if (!validFunctions.includes(targetFunction)) {
    throw new AppError('Invalid target function', 400, 'VALIDATION_ERROR');
  }

  logger.info('Proposing multi-sig transaction', {
    correlationId: req.correlationId,
    multiSigContractId,
    tokenContractId,
    targetFunction,
    proposer: proposerPublicKey,
  });

  const transaction = await multiSigService.proposeTransaction(
    multiSigContractId,
    tokenContractId,
    targetFunction,
    functionArgs,
    proposerPublicKey
  );

  res.status(201).json({
    success: true,
    data: transaction,
  });
}));

router.post('/approve/:txId', authenticate, validateTxId, asyncHandler(async (req, res) => {
  const { txId } = req.params;
  const signerPublicKey = req.user.publicKey;

  logger.info('Approving multi-sig transaction', {
    correlationId: req.correlationId,
    txId,
    signer: signerPublicKey,
  });

  const transaction = await multiSigService.approveTransaction(txId, signerPublicKey);

  res.json({
    success: true,
    data: transaction,
  });
}));

router.post('/execute/:txId', authenticate, validateTxId, asyncHandler(async (req, res) => {
  const { txId } = req.params;
  const executorPublicKey = req.user.publicKey;

  logger.info('Executing multi-sig transaction', {
    correlationId: req.correlationId,
    txId,
    executor: executorPublicKey,
  });

  const transaction = await multiSigService.executeTransaction(txId, executorPublicKey);

  res.json({
    success: true,
    data: transaction,
  });
}));

router.get('/pending/:multiSigContractId', authenticate, validateContractId, asyncHandler(async (req, res) => {
  const { multiSigContractId } = req.params;

  const transactions = await multiSigService.getPendingTransactions(multiSigContractId);

  res.json({
    success: true,
    data: transactions,
  });
}));

router.get('/transaction/:txId', authenticate, validateTxId, asyncHandler(async (req, res) => {
  const { txId } = req.params;

  const transaction = await multiSigService.getTransaction(txId);

  if (!transaction) {
    throw new AppError('Transaction not found', 404, 'NOT_FOUND');
  }

  res.json({
    success: true,
    data: transaction,
  });
}));

router.get('/signers/:multiSigContractId', authenticate, validateContractId, asyncHandler(async (req, res) => {
  const { multiSigContractId } = req.params;

  const signers = await multiSigService.getSigners(multiSigContractId);
  const threshold = await multiSigService.getThreshold(multiSigContractId);

  res.json({
    success: true,
    data: {
      signers,
      threshold,
    },
  });
}));

module.exports = router;
