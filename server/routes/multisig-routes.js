'use strict';

const express = require('express');
const { asyncHandler, AppError } = require('../middleware/error-handler');
const { authenticate } = require('../middleware/auth');
const multiSigService = require('../services/multisig-service');
const { logger } = require('../utils/logger');
const { validateProposal, validateTxId, validateContractId } = require('../validators/multisig-validator');

const router = express.Router();

/**
 * @openapi
 * @route POST /api/multisig/propose
 * @name proposeTransaction
 * @description Propose a new multi-signature transaction
 * @tags Security
 * @security BearerAuth
 * @param {string} multiSigContractId - Multi-sig contract address
 * @param {string} tokenContractId - Token contract address
 * @param {string} targetFunction - Target function to execute (mint, burn, transfer_ownership, set_fee_config, pause, unpause)
 * @param {array} functionArgs - Function arguments
 * @returns {object} 201 - Proposed transaction
 */
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

/**
 * @openapi
 * @route POST /api/multisig/approve/{txId}
 * @name approveTransaction
 * @description Approve a pending multi-signature transaction
 * @tags Security
 * @security BearerAuth
 * @param {string} txId - Transaction ID to approve
 * @returns {object} 200 - Approved transaction
 */
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

/**
 * @openapi
 * @route POST /api/multisig/execute/{txId}
 * @name executeTransaction
 * @description Execute an approved multi-signature transaction
 * @tags Security
 * @security BearerAuth
 * @param {string} txId - Transaction ID to execute
 * @returns {object} 200 - Executed transaction
 */
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

/**
 * @openapi
 * @route GET /api/multisig/pending/{multiSigContractId}
 * @name getPendingTransactions
 * @description Get all pending transactions for a multi-sig contract
 * @tags Security
 * @security BearerAuth
 * @param {string} multiSigContractId - Multi-sig contract address
 * @returns {array} 200 - Array of pending transactions
 */
router.get('/pending/:multiSigContractId', authenticate, validateContractId, asyncHandler(async (req, res) => {
  const { multiSigContractId } = req.params;

  const transactions = await multiSigService.getPendingTransactions(multiSigContractId);

  res.json({
    success: true,
    data: transactions,
  });
}));

/**
 * @openapi
 * @route GET /api/multisig/transaction/{txId}
 * @name getTransaction
 * @description Get details of a specific multi-sig transaction
 * @tags Security
 * @security BearerAuth
 * @param {string} txId - Transaction ID
 * @returns {object} 200 - Transaction details
 * @returns {object} 404 - Transaction not found
 */
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

/**
 * @openapi
 * @route GET /api/multisig/signers/{multiSigContractId}
 * @name getSigners
 * @description Get all signers and threshold for a multi-sig contract
 * @tags Security
 * @security BearerAuth
 * @param {string} multiSigContractId - Multi-sig contract address
 * @returns {object} 200 - Signers list and threshold
 */
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
