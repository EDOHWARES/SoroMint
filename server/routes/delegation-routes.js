const express = require('express');
const router = express.Router();
const delegationService = require('../services/delegation-service');
const { validateJWT } = require('../middleware/auth');
const { validateDelegationInput } = require('../validators/delegation-validator');

/**
 * POST /api/delegation/approve
 * Approve a minter delegation
 */
router.post('/approve', validateJWT, validateDelegationInput.approveMinter, async (req, res) => {
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
 * POST /api/delegation/revoke
 * Revoke a minter delegation
 */
router.post('/revoke', validateJWT, validateDelegationInput.revokeMinter, async (req, res) => {
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
 * POST /api/delegation/mint
 * Execute a delegated mint
 */
router.post('/mint', validateJWT, validateDelegationInput.delegateMint, async (req, res) => {
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
 * GET /api/delegation/:tokenContractId/:owner/:delegate
 * Get delegation details
 */
router.get('/:tokenContractId/:owner/:delegate', validateJWT, async (req, res) => {
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
 * GET /api/delegation/owner/:tokenContractId/:owner
 * Get all delegations for an owner
 */
router.get('/owner/:tokenContractId/:owner', validateJWT, async (req, res) => {
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
 * GET /api/delegation/delegate/:tokenContractId/:delegate
 * Get all delegations for a delegate
 */
router.get('/delegate/:tokenContractId/:delegate', validateJWT, async (req, res) => {
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
 * GET /api/delegation/active/:tokenContractId
 * Get all active delegations for a token
 */
router.get('/active/:tokenContractId', validateJWT, async (req, res) => {
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
 * GET /api/delegation/stats/:tokenContractId
 * Get delegation statistics
 */
router.get('/stats/:tokenContractId', validateJWT, async (req, res) => {
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
 * POST /api/delegation/can-mint
 * Check if a delegation can mint a specific amount
 */
router.post('/can-mint', validateJWT, async (req, res) => {
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
