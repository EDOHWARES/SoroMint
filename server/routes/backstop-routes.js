'use strict';

const express = require('express');
const { authenticate } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/error-handler');
const {
  validateContractId,
  validateDeposit,
  validateWithdraw,
  validateFee,
} = require('../validators/backstop-validator');
const backstopService = require('../services/backstop-service');
const { logger } = require('../utils/logger');

const router = express.Router();

/**
 * @notice Builds the structured log context shared by every Backstop request.
 * @param {object} req - Express request.
 * @param {object} extra - Extra fields to attach to the log payload.
 * @returns {object} Context with correlationId, userId and any extra fields.
 */
const requestContext = (req, extra = {}) => ({
  correlationId: req.correlationId || null,
  userId: req.user?._id?.toString() || req.user?.publicKey || null,
  ...extra,
});

/**
 * @openapi
 * @route GET /api/backstop/:contractId/config
 * @name getBackstopConfig
 * @description Returns the on-chain Backstop configuration (admin, token, fee_bps, totals)
 * @tags Backstop
 * @param {string} contractId.path.required - Backstop contract C-address
 * @returns {object} 200 - Normalised Backstop config
 */
router.get(
  '/backstop/:contractId/config',
  validateContractId,
  asyncHandler(async (req, res) => {
    const { contractId } = req.params;
    const data = await backstopService.getConfig(contractId, requestContext(req));

    logger.info('Backstop config endpoint served', requestContext(req, { contractId }));

    res.json({ success: true, data });
  })
);

/**
 * @openapi
 * @route GET /api/backstop/:contractId/balance
 * @name getBackstopBalance
 * @description Returns the on-chain token balance of the Backstop reserve
 * @tags Backstop
 * @param {string} contractId.path.required - Backstop contract C-address
 * @returns {object} 200 - { success, balance }
 */
router.get(
  '/backstop/:contractId/balance',
  validateContractId,
  asyncHandler(async (req, res) => {
    const { contractId } = req.params;
    const { balance } = await backstopService.getBalance(contractId, requestContext(req));

    logger.info(
      'Backstop balance endpoint served',
      requestContext(req, { contractId, balance })
    );

    res.json({ success: true, balance });
  })
);

/**
 * @openapi
 * @route GET /api/backstop/:contractId/version
 * @name getBackstopVersion
 * @description Returns the Backstop contract version string (health ping)
 * @tags Backstop
 * @param {string} contractId.path.required - Backstop contract C-address
 * @returns {object} 200 - { success, version }
 */
router.get(
  '/backstop/:contractId/version',
  validateContractId,
  asyncHandler(async (req, res) => {
    const { contractId } = req.params;
    const { version } = await backstopService.getVersion(contractId, requestContext(req));

    logger.info(
      'Backstop version endpoint served',
      requestContext(req, { contractId, version })
    );

    res.json({ success: true, version });
  })
);

/**
 * @openapi
 * @route POST /api/backstop/:contractId/deposit
 * @name depositBackstopFee
 * @description Deposits a fee amount into the Backstop reserve (deposit_fee)
 * @tags Backstop
 * @security BearerAuth
 * @param {string} contractId.path.required - Backstop contract C-address
 * @returns {object} 200 - { success, data: { txHash, status } }
 */
router.post(
  '/backstop/:contractId/deposit',
  authenticate,
  validateContractId,
  validateDeposit,
  asyncHandler(async (req, res) => {
    const { contractId } = req.params;
    const { from, amount } = req.body;

    const result = await backstopService.depositFee({
      contractId,
      from,
      amount,
      ...requestContext(req),
    });

    logger.info(
      'Backstop deposit completed',
      requestContext(req, { contractId, txHash: result.txHash })
    );

    res.json({ success: true, data: result });
  })
);

/**
 * @openapi
 * @route POST /api/backstop/:contractId/withdraw
 * @name withdrawBackstop
 * @description Admin withdrawal from the Backstop reserve (withdraw)
 * @tags Backstop
 * @security BearerAuth
 * @param {string} contractId.path.required - Backstop contract C-address
 * @returns {object} 200 - { success, data: { txHash, status } }
 */
router.post(
  '/backstop/:contractId/withdraw',
  authenticate,
  validateContractId,
  validateWithdraw,
  asyncHandler(async (req, res) => {
    const { contractId } = req.params;
    const { to, amount } = req.body;

    const result = await backstopService.withdraw({
      contractId,
      to,
      amount,
      ...requestContext(req),
    });

    logger.info(
      'Backstop withdraw completed',
      requestContext(req, { contractId, txHash: result.txHash })
    );

    res.json({ success: true, data: result });
  })
);

/**
 * @openapi
 * @route PATCH /api/backstop/:contractId/fee
 * @name setBackstopFeeBps
 * @description Updates the Backstop fee rate (set_fee_bps, admin only)
 * @tags Backstop
 * @security BearerAuth
 * @param {string} contractId.path.required - Backstop contract C-address
 * @returns {object} 200 - { success, data: { txHash, status } }
 */
router.patch(
  '/backstop/:contractId/fee',
  authenticate,
  validateContractId,
  validateFee,
  asyncHandler(async (req, res) => {
    const { contractId } = req.params;
    const { fee_bps } = req.body;

    const result = await backstopService.setFeeBps({
      contractId,
      fee_bps,
      ...requestContext(req),
    });

    logger.info(
      'Backstop fee rate updated',
      requestContext(req, { contractId, txHash: result.txHash })
    );

    res.json({ success: true, data: result });
  })
);

module.exports = router;
