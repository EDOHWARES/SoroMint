'use strict';

const express = require('express');
const { asyncHandler, AppError } = require('../middleware/error-handler');
const { authenticate } = require('../middleware/auth');
const vaultService = require('../services/vault-service');
const { logger } = require('../utils/logger');

const router = express.Router();

/**
 * @openapi
 * @route POST /api/vault/create
 * @name createVault
 * @description Create a new collateralized vault
 * @tags Vault
 * @security BearerAuth
 * @param {string} vaultContractId - Vault contract address
 * @param {string} collateralToken - Collateral token contract address
 * @param {string} collateralAmount - Initial collateral amount
 * @param {string} smtAmount - SMT amount to mint
 * @returns {object} 201 - Created vault details
 */
router.post('/create', authenticate, asyncHandler(async (req, res) => {
  const { vaultContractId, collateralToken, collateralAmount, smtAmount } = req.body;
  const user = req.user.publicKey;

  if (!vaultContractId || !collateralToken || !collateralAmount || !smtAmount) {
    throw new AppError('Missing required fields', 400, 'VALIDATION_ERROR');
  }

  logger.info('Creating vault', {
    correlationId: req.correlationId,
    user,
    collateralToken,
    collateralAmount,
    smtAmount,
  });

  const vault = await vaultService.createVault(
    vaultContractId,
    user,
    collateralToken,
    collateralAmount,
    smtAmount
  );

  res.status(201).json({
    success: true,
    data: vault,
  });
}));

/**
 * @openapi
 * @route POST /api/vault/{vaultId}/add-collateral
 * @name addCollateral
 * @description Add collateral to an existing vault
 * @tags Vault
 * @security BearerAuth
 * @param {string} vaultId - Vault ID
 * @param {string} vaultContractId - Vault contract address
 * @param {string} collateralToken - Collateral token address
 * @param {string} amount - Amount to add
 * @returns {object} 200 - Updated vault details
 */
router.post('/:vaultId/add-collateral', authenticate, asyncHandler(async (req, res) => {
  const { vaultId } = req.params;
  const { vaultContractId, collateralToken, amount } = req.body;

  const vault = await vaultService.addCollateral(
    vaultContractId,
    vaultId,
    collateralToken,
    amount
  );

  res.json({
    success: true,
    data: vault,
  });
}));

/**
 * @openapi
 * @route POST /api/vault/{vaultId}/mint
 * @name mintVault
 * @description Mint more SMT tokens against existing collateral
 * @tags Vault
 * @security BearerAuth
 * @param {string} vaultId - Vault ID
 * @param {string} vaultContractId - Vault contract address
 * @param {string} smtAmount - SMT amount to mint
 * @returns {object} 200 - Updated vault details
 */
router.post('/:vaultId/mint', authenticate, asyncHandler(async (req, res) => {
  const { vaultId } = req.params;
  const { vaultContractId, smtAmount } = req.body;

  const vault = await vaultService.mintMore(vaultContractId, vaultId, smtAmount);

  res.json({
    success: true,
    data: vault,
  });
}));

/**
 * @openapi
 * @route POST /api/vault/{vaultId}/repay
 * @name repayVault
 * @description Repay debt and optionally withdraw collateral
 * @tags Vault
 * @security BearerAuth
 * @param {string} vaultId - Vault ID
 * @param {string} vaultContractId - Vault contract address
 * @param {string} repayAmount - Amount to repay (optional)
 * @param {string} collateralToken - Collateral token address (optional)
 * @param {string} withdrawAmount - Collateral to withdraw (optional)
 * @returns {object} 200 - Updated vault details
 */
router.post('/:vaultId/repay', authenticate, asyncHandler(async (req, res) => {
  const { vaultId } = req.params;
  const { vaultContractId, repayAmount, collateralToken, withdrawAmount } = req.body;

  const vault = await vaultService.repayAndWithdraw(
    vaultContractId,
    vaultId,
    repayAmount || 0,
    collateralToken,
    withdrawAmount || 0
  );

  res.json({
    success: true,
    data: vault,
  });
}));

/**
 * @openapi
 * @route POST /api/vault/{vaultId}/liquidate
 * @name liquidateVault
 * @description Liquidate an undercollateralized vault
 * @tags Vault
 * @security BearerAuth
 * @param {string} vaultId - Vault ID to liquidate
 * @param {string} vaultContractId - Vault contract address
 * @param {string} debtToCover - Debt amount to cover
 * @returns {object} 200 - Liquidation result
 */
router.post('/:vaultId/liquidate', authenticate, asyncHandler(async (req, res) => {
  const { vaultId } = req.params;
  const { vaultContractId, debtToCover } = req.body;
  const liquidator = req.user.publicKey;

  const vault = await vaultService.liquidate(
    vaultContractId,
    vaultId,
    liquidator,
    debtToCover
  );

  res.json({
    success: true,
    data: vault,
  });
}));

/**
 * @openapi
 * @route GET /api/vault/{vaultId}
 * @name getVault
 * @description Get vault details by ID
 * @tags Vault
 * @security BearerAuth
 * @param {string} vaultId - Vault ID
 * @param {string} vaultContractId - Vault contract address
 * @returns {object} 200 - Vault details
 */
router.get('/:vaultId', authenticate, asyncHandler(async (req, res) => {
  const { vaultId } = req.params;
  const { vaultContractId } = req.query;

  const vault = await vaultService.getVault(vaultContractId, vaultId);

  res.json({
    success: true,
    data: vault,
  });
}));

/**
 * @openapi
 * @route GET /api/vault/{vaultId}/health
 * @name getVaultHealth
 * @description Get the health factor of a vault
 * @tags Vault
 * @security BearerAuth
 * @param {string} vaultId - Vault ID
 * @param {string} vaultContractId - Vault contract address
 * @returns {object} 200 - Health factor and collateralization ratio
 */
router.get('/:vaultId/health', authenticate, asyncHandler(async (req, res) => {
  const { vaultId } = req.params;
  const { vaultContractId } = req.query;

  const health = await vaultService.getVaultHealth(vaultContractId, vaultId);

  res.json({
    success: true,
    data: {
      vaultId,
      collateralizationRatio: health,
    },
  });
}));

/**
 * @openapi
 * @route GET /api/vault/user/{userAddress}
 * @name getUserVaults
 * @description Get all vaults owned by a specific user
 * @tags Vault
 * @security BearerAuth
 * @param {string} userAddress - User's Stellar public key
 * @param {string} vaultContractId - Vault contract address
 * @returns {array} 200 - Array of user's vaults
 */
router.get('/user/:userAddress', authenticate, asyncHandler(async (req, res) => {
  const { userAddress } = req.params;
  const { vaultContractId } = req.query;

  const vaults = await vaultService.getUserVaults(vaultContractId, userAddress);

  res.json({
    success: true,
    data: vaults,
  });
}));

/**
 * @openapi
 * @route GET /api/vault/liquidatable/list
 * @name getLiquidatableVaults
 * @description Get all vaults eligible for liquidation
 * @tags Vault
 * @security BearerAuth
 * @param {string} vaultContractId - Vault contract address
 * @param {number} threshold - Health factor threshold (default: 130)
 * @returns {array} 200 - Array of liquidatable vaults
 */
router.get('/liquidatable/list', authenticate, asyncHandler(async (req, res) => {
  const { vaultContractId, threshold } = req.query;

  const vaults = await vaultService.getLiquidatableVaults(
    vaultContractId,
    threshold ? parseInt(threshold) : 130
  );

  res.json({
    success: true,
    data: vaults,
  });
}));

module.exports = router;
