const { body, param, validationResult } = require('express-validator');
const { AppError } = require('../middleware/error-handler');

const validateProposal = [
  body('multiSigContractId')
    .isString()
    .trim()
    .notEmpty()
    .withMessage('Multi-sig contract ID is required')
    .matches(/^C[A-Z0-9]{55}$/)
    .withMessage('Invalid multi-sig contract ID format'),
  
  body('tokenContractId')
    .isString()
    .trim()
    .notEmpty()
    .withMessage('Token contract ID is required')
    .matches(/^C[A-Z0-9]{55}$/)
    .withMessage('Invalid token contract ID format'),
  
  body('targetFunction')
    .isString()
    .trim()
    .notEmpty()
    .withMessage('Target function is required')
    .isIn(['mint', 'burn', 'transfer_ownership', 'set_fee_config', 'pause', 'unpause'])
    .withMessage('Invalid target function'),
  
  body('functionArgs')
    .isObject()
    .withMessage('Function arguments must be an object'),
  
  (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      throw new AppError(
        'Validation failed',
        400,
        'VALIDATION_ERROR',
        errors.array()
      );
    }
    next();
  },
];

const validateTxId = [
  param('txId')
    .isString()
    .trim()
    .notEmpty()
    .withMessage('Transaction ID is required'),
  
  (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      throw new AppError(
        'Validation failed',
        400,
        'VALIDATION_ERROR',
        errors.array()
      );
    }
    next();
  },
];

const validateContractId = [
  param('multiSigContractId')
    .isString()
    .trim()
    .notEmpty()
    .withMessage('Multi-sig contract ID is required')
    .matches(/^C[A-Z0-9]{55}$/)
    .withMessage('Invalid multi-sig contract ID format'),
  
  (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      throw new AppError(
        'Validation failed',
        400,
        'VALIDATION_ERROR',
        errors.array()
      );
    }
    next();
  },
];

module.exports = {
  validateProposal,
  validateTxId,
  validateContractId,
};
