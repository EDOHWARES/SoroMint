const { body, param, query, validationResult } = require('express-validator');
const { AppError } = require('../middleware/error-handler');

const validateProposal = [
  body('tokenId').isMongoId().withMessage('Invalid token ID'),
  body('contractId').isString().trim().notEmpty().withMessage('Contract ID is required'),
  body('proposer').isString().trim().notEmpty().withMessage('Proposer address is required'),
  body('changes').isObject().withMessage('Changes must be an object'),
  body('changes.name').optional().isString().trim().isLength({ min: 1, max: 100 }),
  body('changes.symbol').optional().isString().trim().isLength({ min: 1, max: 10 }),
  body('quorum').optional().isInt({ min: 1, max: 100 }).withMessage('Quorum must be between 1-100'),
  body('durationDays').optional().isInt({ min: 1, max: 30 }).withMessage('Duration must be 1-30 days'),
  (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      throw new AppError(errors.array()[0].msg, 400, 'VALIDATION_ERROR');
    }
    next();
  },
];

const validateVote = [
  body('proposalId').isMongoId().withMessage('Invalid proposal ID'),
  body('voter').isString().trim().notEmpty().withMessage('Voter address is required'),
  body('support').isBoolean().withMessage('Support must be true or false'),
  (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      throw new AppError(errors.array()[0].msg, 400, 'VALIDATION_ERROR');
    }
    next();
  },
];

const validateProposalId = [
  param('proposalId').isMongoId().withMessage('Invalid proposal ID'),
  (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      throw new AppError(errors.array()[0].msg, 400, 'VALIDATION_ERROR');
    }
    next();
  },
];

const validateTokenQuery = [
  query('tokenId').isMongoId().withMessage('Invalid token ID'),
  query('status').optional().isIn(['PENDING', 'ACTIVE', 'EXECUTED', 'REJECTED', 'EXPIRED']),
  (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      throw new AppError(errors.array()[0].msg, 400, 'VALIDATION_ERROR');
    }
    next();
  },
];

module.exports = {
  validateProposal,
  validateVote,
  validateProposalId,
  validateTokenQuery,
};
