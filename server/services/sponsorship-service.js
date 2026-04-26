const { AppError } = require('../middleware/error-handler');
const { getEnv } = require('../config/env-config');
const { submitFeeBumpTransaction } = require('./stellar-service');
const { logger } = require('../utils/logger');

const normalizeBudget = (value, fallback) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return fallback;
  }
  return Math.trunc(parsed);
};

const getEffectiveBudgetLimit = (user, env = getEnv()) => {
  const userLimit = normalizeBudget(user.sponsorshipBudgetLimitStroops, 0);
  return userLimit > 0 ? userLimit : normalizeBudget(env.MAX_SPONSORSHIP_FEE_STROOPS, 0);
};

const getRemainingBudget = (user, env = getEnv()) => {
  const budgetLimitStroops = getEffectiveBudgetLimit(user, env);
  const budgetUsedStroops = normalizeBudget(user.sponsorshipBudgetUsedStroops, 0);
  return Math.max(0, budgetLimitStroops - budgetUsedStroops);
};

const getSponsorshipStatus = (user, env = getEnv()) => {
  const budgetLimitStroops = getEffectiveBudgetLimit(user, env);
  const budgetUsedStroops = normalizeBudget(user.sponsorshipBudgetUsedStroops, 0);
  const remainingBudgetStroops = getRemainingBudget(user, env);

  return {
    enabled: Boolean(env.SPONSORSHIP_ENABLED),
    userOptedIn: Boolean(user.sponsorshipEnabled),
    status: user.sponsorshipStatus || 'inactive',
    budgetLimitStroops,
    budgetUsedStroops,
    remainingBudgetStroops,
    maxSponsoredFeeStroops: normalizeBudget(env.MAX_SPONSORSHIP_FEE_STROOPS, 0),
    approvedAt: user.sponsorshipApprovedAt || null,
    lastSponsoredAt: user.sponsorshipLastSponsoredAt || null,
  };
};

const checkSponsorshipEligibility = (user, requestedFeeStroops = 0, env = getEnv()) => {
  const normalizedFee = normalizeBudget(requestedFeeStroops, 0);
  const status = getSponsorshipStatus(user, env);
  const reasons = [];

  if (!env.SPONSORSHIP_ENABLED) {
    reasons.push('Sponsorship is disabled');
  }

  if (!env.PLATFORM_SECRET_KEY) {
    reasons.push('Platform sponsorship signer is not configured');
  }

  if (!user.isActive || !user.isActive()) {
    reasons.push('User account is not active');
  }

  if (!user.sponsorshipEnabled) {
    reasons.push('User has not enabled sponsorship');
  }

  if (status.status !== 'approved') {
    reasons.push(`User sponsorship status is ${status.status}`);
  }

  if (normalizedFee > status.maxSponsoredFeeStroops) {
    reasons.push('Requested fee exceeds platform sponsorship maximum');
  }

  if (normalizedFee > status.remainingBudgetStroops) {
    reasons.push('Requested fee exceeds remaining sponsorship budget');
  }

  return {
    eligible: reasons.length === 0,
    requestedFeeStroops: normalizedFee,
    reasons,
    ...status,
  };
};

const applyForSponsorship = async (user, options = {}) => {
  const env = getEnv();

  if (!env.SPONSORSHIP_ENABLED) {
    throw new AppError('Sponsorship is not enabled on this server', 503, 'SPONSORSHIP_DISABLED');
  }

  if (!user.isActive || !user.isActive()) {
    throw new AppError('Only active users can apply for sponsorship', 403, 'ACCOUNT_INACTIVE');
  }

  const requestedBudget = options.requestedBudgetStroops;
  const normalizedRequestedBudget = requestedBudget === undefined || requestedBudget === null
    ? normalizeBudget(env.MAX_SPONSORSHIP_FEE_STROOPS, 0)
    : normalizeBudget(requestedBudget, -1);

  if (normalizedRequestedBudget < 0) {
    throw new AppError('requestedBudgetStroops must be a non-negative integer', 400, 'INVALID_PARAMETER');
  }

  user.sponsorshipEnabled = true;
  user.sponsorshipStatus = 'approved';
  user.sponsorshipBudgetLimitStroops = Math.min(
    normalizedRequestedBudget || normalizeBudget(env.MAX_SPONSORSHIP_FEE_STROOPS, 0),
    normalizeBudget(env.MAX_SPONSORSHIP_FEE_STROOPS, 0)
  );
  user.sponsorshipApprovedAt = new Date();

  await user.save();

  logger.info('User sponsorship approved', {
    userId: user._id?.toString?.() || user.publicKey,
    publicKey: user.publicKey,
    budgetLimitStroops: user.sponsorshipBudgetLimitStroops,
  });

  return getSponsorshipStatus(user, env);
};

const recordSponsoredSpend = async (user, feeStroops) => {
  user.sponsorshipBudgetUsedStroops = normalizeBudget(user.sponsorshipBudgetUsedStroops, 0)
    + normalizeBudget(feeStroops, 0);
  user.sponsorshipLastSponsoredAt = new Date();
  await user.save();
};

const executeSponsoredTransaction = async (user, options = {}) => {
  const env = getEnv();
  const { transactionXdr } = options;

  if (!transactionXdr || typeof transactionXdr !== 'string' || !transactionXdr.trim()) {
    throw new AppError('transactionXdr is required', 400, 'VALIDATION_ERROR');
  }

  const requestedFeeStroops = options.feeStroops === undefined || options.feeStroops === null
    ? normalizeBudget(env.MAX_SPONSORSHIP_FEE_STROOPS, 0)
    : normalizeBudget(options.feeStroops, -1);

  if (requestedFeeStroops <= 0) {
    throw new AppError('feeStroops must be a positive integer', 400, 'INVALID_PARAMETER');
  }

  const eligibility = checkSponsorshipEligibility(user, requestedFeeStroops, env);
  if (!eligibility.eligible) {
    throw new AppError(
      `Transaction is not eligible for sponsorship: ${eligibility.reasons.join(', ')}`,
      403,
      'SPONSORSHIP_NOT_ELIGIBLE'
    );
  }

  const submission = await submitFeeBumpTransaction({
    innerTransactionXdr: transactionXdr.trim(),
    sponsorSecretKey: env.PLATFORM_SECRET_KEY,
    baseFeeStroops: requestedFeeStroops,
    networkPassphrase: env.NETWORK_PASSPHRASE,
  });

  if (!submission.success) {
    throw new AppError('Sponsored transaction submission failed', 502, 'SPONSORSHIP_SUBMISSION_FAILED');
  }

  await recordSponsoredSpend(user, requestedFeeStroops);

  logger.info('Sponsored transaction executed', {
    userId: user._id?.toString?.() || user.publicKey,
    publicKey: user.publicKey,
    hash: submission.hash,
    feeStroops: requestedFeeStroops,
  });

  return {
    hash: submission.hash,
    status: submission.status,
    feeBumpXdr: submission.feeBumpXdr,
    sponsoredFeeStroops: requestedFeeStroops,
    sponsorship: getSponsorshipStatus(user, env),
  };
};

module.exports = {
  applyForSponsorship,
  checkSponsorshipEligibility,
  executeSponsoredTransaction,
  getEffectiveBudgetLimit,
  getRemainingBudget,
  getSponsorshipStatus,
};
