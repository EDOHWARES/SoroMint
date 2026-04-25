'use strict';

const express = require('express');
const { authenticate } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/error-handler');
const { logger } = require('../utils/logger');
const { validateDelegationInput } = require('../validators/delegation-validator');
const delegationService = require('../services/delegation-service');

const router = express.Router();

/**
 * @openapi
 * @route POST /api/delegation/approve
 * @name approveMinterDelegation
 * @description Approve a minter delegation allowing a delegate to mint tokens on behalf of an owner
 * @tags Delegation
 * @security BearerAuth
 * @param {string} tokenContractId - Token contract ID (C...)
 * @param {string} owner - Owner Stellar public key (G...)
 * @param {string} delegate - Delegate Stellar public key (G...)
 * @param {string} limit - Minting limit as integer string
 * @param {string} sponsor - Sponsor Stellar public key (G...)
 * @returns {object} 200 - Delegation approved successfully
 * @returns {object} 400 - Delegation approval failed
 */
router.post('/approve', authenticate, validateDelegationInput.approveMinter, async (req, res) => {
  try {
    const { tokenContractId, owner, delegate, limit, sponsor } = req.body;

    const result = await delegationService.approveMinter(
      tokenContractId,
      owner,
      delegate,
      BigInt(limit),
      sponsor
    );

    res.json({
      success: true,
      data: result,
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * @openapi
 * @route POST /api/delegation/revoke
 * @name revokeMinterDelegation
 * @description Revoke a minter delegation
 * @tags Delegation
 * @security BearerAuth
 * @param {string} tokenContractId - Token contract ID (C...)
 * @param {string} owner - Owner Stellar public key (G...)
 * @param {string} delegate - Delegate Stellar public key (G...)
 * @returns {object} 200 - Delegation revoked successfully
 * @returns {object} 400 - Revocation failed
 */
router.post('/revoke', authenticate, validateDelegationInput.revokeMinter, async (req, res) => {
  try {
    const { tokenContractId, owner, delegate } = req.body;

    const result = await delegationService.revokeMinter(tokenContractId, owner, delegate);

    res.json({
      success: true,
      data: result,
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * @openapi
 * @route POST /api/delegation/mint
 * @name delegateMint
 * @description Execute a delegated mint operation
 * @tags Delegation
 * @security BearerAuth
 * @param {string} tokenContractId - Token contract ID (C...)
 * @param {string} delegate - Delegate Stellar public key (G...)
 * @param {string} owner - Owner Stellar public key (G...)
 * @param {string} to - Recipient Stellar public key (G...)
 * @param {string} amount - Amount to mint as integer string
 * @returns {object} 200 - Mint executed successfully
 * @returns {object} 400 - Mint failed
 */
router.post('/mint', authenticate, validateDelegationInput.delegateMint, async (req, res) => {
  try {
    const { tokenContractId, delegate, owner, to, amount } = req.body;

    const result = await delegationService.delegateMint(
      tokenContractId,
      delegate,
      owner,
      to,
      BigInt(amount)
    );

    res.json({
      success: true,
      data: result,
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * @openapi
 * @route GET /api/delegation/{tokenContractId}/{owner}/{delegate}
 * @name getDelegation
 * @description Get delegation details for a specific token, owner, and delegate
 * @tags Delegation
 * @security BearerAuth
 * @param {string} tokenContractId - Token contract ID (C...)
 * @param {string} owner - Owner Stellar public key (G...)
 * @param {string} delegate - Delegate Stellar public key (G...)
 * @returns {object} 200 - Delegation details
 * @returns {object} 400 - Query failed
 */
router.get('/:tokenContractId/:owner/:delegate', authenticate, async (req, res) => {
  try {
    const { tokenContractId, owner, delegate } = req.params;

    const result = await delegationService.getDelegation(tokenContractId, owner, delegate);

    res.json({
      success: true,
      data: result,
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * @openapi
 * @route GET /api/delegation/owner/{tokenContractId}/{owner}
 * @name getDelegationsByOwner
 * @description Get all delegations where the specified owner has delegated minting rights
 * @tags Delegation
 * @security BearerAuth
 * @param {string} tokenContractId - Token contract ID (C...)
 * @param {string} owner - Owner Stellar public key (G...)
 * @returns {object} 200 - List of delegations
 * @returns {object} 400 - Query failed
 */
router.get('/owner/:tokenContractId/:owner', authenticate, async (req, res) => {
  try {
    const { tokenContractId, owner } = req.params;

    const delegations = await delegationService.getDelegationsByOwner(tokenContractId, owner);

    res.json({
      success: true,
      data: delegations,
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * @openapi
 * @route GET /api/delegation/delegate/{tokenContractId}/{delegate}
 * @name getDelegationsByDelegate
 * @description Get all active delegations where the specified address is the delegate
 * @tags Delegation
 * @security BearerAuth
 * @param {string} tokenContractId - Token contract ID (C...)
 * @param {string} delegate - Delegate Stellar public key (G...)
 * @returns {object} 200 - List of delegations
 * @returns {object} 400 - Query failed
 */
router.get('/delegate/:tokenContractId/:delegate', authenticate, async (req, res) => {
  try {
    const { tokenContractId, delegate } = req.params;

    const delegations = await delegationService.getDelegationsByDelegate(
      tokenContractId,
      delegate
    );

    res.json({
      success: true,
      data: delegations,
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * @openapi
 * @route GET /api/delegation/active/{tokenContractId}
 * @name getActiveDelegations
 * @description Get all active delegations for a token contract
 * @tags Delegation
 * @security BearerAuth
 * @param {string} tokenContractId - Token contract ID (C...)
 * @returns {object} 200 - List of active delegations
 * @returns {object} 400 - Query failed
 */
router.get('/active/:tokenContractId', authenticate, async (req, res) => {
  try {
    const { tokenContractId } = req.params;

    const delegations = await delegationService.getActiveDelegations(tokenContractId);

    res.json({
      success: true,
      data: delegations,
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * @openapi
 * @route GET /api/delegation/stats/{tokenContractId}
 * @name getDelegationStats
 * @description Get delegation statistics for a token contract
 * @tags Delegation
 * @security BearerAuth
 * @param {string} tokenContractId - Token contract ID (C...)
 * @returns {object} 200 - Delegation statistics
 * @returns {object} 400 - Query failed
 */
router.get('/stats/:tokenContractId', authenticate, async (req, res) => {
  try {
    const { tokenContractId } = req.params;

    const stats = await delegationService.getDelegationStats(tokenContractId);

    res.json({
      success: true,
      data: stats,
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * @openapi
 * @route POST /api/delegation/can-mint
 * @name checkCanMint
 * @description Check if a delegation can mint a specific amount
 * @tags Delegation
 * @security BearerAuth
 * @param {string} tokenContractId - Token contract ID (C...)
 * @param {string} owner - Owner Stellar public key (G...)
 * @param {string} delegate - Delegate Stellar public key (G...)
 * @param {string} amount - Amount to check as integer string
 * @returns {object} 200 - Can mint check result
 * @returns {object} 400 - Check failed
 */
router.post('/can-mint', authenticate, async (req, res) => {
  try {
    const { tokenContractId, owner, delegate, amount } = req.body;

    const result = await delegationService.canMint(
      tokenContractId,
      owner,
      delegate,
      BigInt(amount)
    );

    res.json({
      success: true,
      data: result,
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      error: error.message,
    });
  }
});

module.exports = router;
