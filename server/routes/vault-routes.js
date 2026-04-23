const express = require('express');
const { asyncHandler, AppError } = require('../middleware/error-handler');
const { authenticate } = require('../middleware/auth');
const vaultService = require('../services/vault-service');
const { logger } = require('../utils/logger');

const router = express.Router();

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

router.post('/:vaultId/mint', authenticate, asyncHandler(async (req, res) => {
  const { vaultId } = req.params;
  const { vaultContractId, smtAmount } = req.body;

  const vault = await vaultService.mintMore(vaultContractId, vaultId, smtAmount);

  res.json({
    success: true,
    data: vault,
  });
}));

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

router.get('/:vaultId', authenticate, asyncHandler(async (req, res) => {
  const { vaultId } = req.params;
  const { vaultContractId } = req.query;

  const vault = await vaultService.getVault(vaultContractId, vaultId);

  res.json({
    success: true,
    data: vault,
  });
}));

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

router.get('/user/:userAddress', authenticate, asyncHandler(async (req, res) => {
  const { userAddress } = req.params;
  const { vaultContractId } = req.query;

  const vaults = await vaultService.getUserVaults(vaultContractId, userAddress);

  res.json({
    success: true,
    data: vaults,
  });
}));

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
