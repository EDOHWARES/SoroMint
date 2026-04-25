'use strict';

/**
 * @title Dividend Distribution Routes
 * @description REST API routes for the DividendDistributor Soroban contract.
 * @notice Off-chain coordination layer for on-chain dividend distribution.
 */

const express = require('express');
const { asyncHandler, AppError } = require('../middleware/error-handler');
const { authenticate } = require('../middleware/auth');
const { logger } = require('../utils/logger');

const router = express.Router();

/**
 * @openapi
 * @route GET /api/dividend/stats
 * @name getDividendStats
 * @description Get global dividend distribution statistics (global DPS and total XLM distributed)
 * @tags Dividend
 * @param {string} contractId - DividendDistributor contract address (C...)
 * @returns {object} 200 - Dividend statistics
 * @returns {object} 400 - Missing contractId
 */
router.get(
  '/dividend/stats',
  asyncHandler(async (req, res) => {
    const { contractId } = req.query;

    if (!contractId) {
      throw new AppError('contractId query param is required', 400, 'VALIDATION_ERROR');
    }

    logger.info('Dividend stats requested', {
      correlationId: req.correlationId,
      contractId,
    });

    res.json({
      success: true,
      data: {
        contractId,
        globalDps: '0',
        totalDistributed: '0',
        note: 'Invoke global_dps() and total_distributed() on-chain for live values',
      },
    });
  })
);

/**
 * @openapi
 * @route GET /api/dividend/claimable/{holderAddress}
 * @name getDividendClaimable
 * @description Query how much XLM a holder can claim from the dividend distribution
 * @tags Dividend
 * @param {string} holderAddress - Stellar public key of the holder (G...)
 * @param {string} contractId - DividendDistributor contract address (C...)
 * @param {string} holderBalance - Holder's token balance in base units (integer string)
 * @returns {object} 200 - Claimable amount in stroops
 * @returns {object} 400 - Missing required params or invalid holder address
 */
router.get(
  '/dividend/claimable/:holderAddress',
  asyncHandler(async (req, res) => {
    const { holderAddress } = req.params;
    const { contractId, holderBalance } = req.query;

    if (!contractId || !holderBalance) {
      throw new AppError(
        'contractId and holderBalance query params are required',
        400,
        'VALIDATION_ERROR'
      );
    }

    if (!holderAddress || holderAddress.length !== 56) {
      throw new AppError('holderAddress must be a valid 56-character Stellar address', 400, 'VALIDATION_ERROR');
    }

    logger.info('Dividend claimable query', {
      correlationId: req.correlationId,
      holderAddress,
      contractId,
    });

    res.json({
      success: true,
      data: {
        holderAddress,
        contractId,
        holderBalance,
        claimableStroops: '0',
        note: 'Invoke claimable() on-chain for live values',
      },
    });
  })
);

/**
 * @openapi
 * @route POST /api/dividend/deposit
 * @name buildDividendDeposit
 * @description Build a deposit transaction for the issuer to sign (unsigned XDR)
 * @tags Dividend
 * @security BearerAuth
 * @param {string} contractId - DividendDistributor contract address (C...)
 * @param {string} depositorAddress - Issuer's Stellar public key (G...)
 * @param {string} amountStroops - XLM amount in stroops (positive integer string)
 * @param {string} totalSupply - Current total token supply (integer string)
 * @returns {object} 200 - Unsigned XDR for client-side signing
 * @returns {object} 400 - Missing or invalid fields
 * @returns {object} 401 - Unauthorized
 */
router.post(
  '/dividend/deposit',
  authenticate,
  asyncHandler(async (req, res) => {
    const { contractId, depositorAddress, amountStroops, totalSupply } = req.body;

    if (!contractId || !depositorAddress || !amountStroops || !totalSupply) {
      throw new AppError(
        'contractId, depositorAddress, amountStroops, and totalSupply are required',
        400,
        'VALIDATION_ERROR'
      );
    }

    if (BigInt(amountStroops) <= 0n) {
      throw new AppError('amountStroops must be a positive integer', 400, 'VALIDATION_ERROR');
    }

    if (BigInt(totalSupply) <= 0n) {
      throw new AppError('totalSupply must be a positive integer', 400, 'VALIDATION_ERROR');
    }

    logger.info('Dividend deposit transaction requested', {
      correlationId: req.correlationId,
      contractId,
      depositorAddress,
      amountStroops,
      totalSupply,
    });

    res.json({
      success: true,
      data: {
        contractId,
        depositorAddress,
        amountStroops,
        totalSupply,
        unsignedXdr: null,
        note: 'Sign and submit deposit() directly via Soroban CLI or Freighter SDK',
      },
    });
  })
);

/**
 * @openapi
 * @route POST /api/dividend/claim
 * @name buildDividendClaim
 * @description Build a claim transaction for a holder to sign (unsigned XDR)
 * @tags Dividend
 * @security BearerAuth
 * @param {string} contractId - DividendDistributor contract address (C...)
 * @param {string} holderAddress - Holder's Stellar public key (G...)
 * @param {string} holderBalance - Holder's current token balance (integer string)
 * @returns {object} 200 - Unsigned XDR for client-side signing
 * @returns {object} 400 - Missing or invalid fields
 * @returns {object} 401 - Unauthorized
 */
router.post(
  '/dividend/claim',
  authenticate,
  asyncHandler(async (req, res) => {
    const { contractId, holderAddress, holderBalance } = req.body;

    if (!contractId || !holderAddress || !holderBalance) {
      throw new AppError(
        'contractId, holderAddress, and holderBalance are required',
        400,
        'VALIDATION_ERROR'
      );
    }

    logger.info('Dividend claim transaction requested', {
      correlationId: req.correlationId,
      contractId,
      holderAddress,
      holderBalance,
    });

    res.json({
      success: true,
      data: {
        contractId,
        holderAddress,
        holderBalance,
        unsignedXdr: null,
        note: 'Sign and submit claim() directly via Soroban CLI or Freighter SDK',
      },
    });
  })
);

module.exports = router;
