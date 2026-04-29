const { body, validationResult } = require('express-validator');

const validateContractId = body('tokenContractId')
  .isString()
  .matches(/^C[A-Z0-9]{55}$/)
  .withMessage('Invalid token contract ID format');

const validateAddress = (fieldName) =>
  body(fieldName)
    .isString()
    .matches(/^G[A-Z0-9]{55}$/)
    .withMessage(`Invalid ${fieldName} format`);

const validateAmount = (fieldName) =>
  body(fieldName)
    .isString()
    .matches(/^\d+$/)
    .withMessage(`${fieldName} must be a positive integer string`);

const handleValidationErrors = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      errors: errors.array(),
    });
  }
  next();
};

const validateDelegationInput = {
  approveMinter: [
    validateContractId,
    validateAddress('owner'),
    validateAddress('delegate'),
    validateAmount('limit'),
    body('sponsor')
      .optional()
      .isString()
      .matches(/^G[A-Z0-9]{55}$/)
      .withMessage('Invalid sponsor address format'),
    handleValidationErrors,
  ],

  revokeMinter: [
    validateContractId,
    validateAddress('owner'),
    validateAddress('delegate'),
    handleValidationErrors,
  ],

  delegateMint: [
    validateContractId,
    validateAddress('delegate'),
    validateAddress('owner'),
    validateAddress('to'),
    validateAmount('amount'),
    handleValidationErrors,
  ],
};

module.exports = { validateDelegationInput };
