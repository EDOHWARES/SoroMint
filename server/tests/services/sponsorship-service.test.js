jest.mock('../../config/env-config', () => ({
  getEnv: jest.fn(),
}));

jest.mock('../../services/stellar-service', () => ({
  submitFeeBumpTransaction: jest.fn(),
}));

jest.mock('../../utils/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

const { getEnv } = require('../../config/env-config');
const { submitFeeBumpTransaction } = require('../../services/stellar-service');
const {
  applyForSponsorship,
  checkSponsorshipEligibility,
  executeSponsoredTransaction,
  getRemainingBudget,
  getSponsorshipStatus,
} = require('../../services/sponsorship-service');

describe('sponsorship-service', () => {
  let user;

  beforeEach(() => {
    jest.clearAllMocks();
    getEnv.mockReturnValue({
      SPONSORSHIP_ENABLED: true,
      PLATFORM_SECRET_KEY: 'SPLATFORMSECRET',
      MAX_SPONSORSHIP_FEE_STROOPS: 5000,
      NETWORK_PASSPHRASE: 'Test SDF Network ; September 2015',
    });

    user = {
      _id: 'user-1',
      publicKey: 'GDZYF2MVD4MMJIDNVTVCKRWP7F55N56CGKUCLH7SZ7KJQLGMMFMNVOVP',
      sponsorshipEnabled: false,
      sponsorshipStatus: 'inactive',
      sponsorshipBudgetLimitStroops: 0,
      sponsorshipBudgetUsedStroops: 0,
      sponsorshipApprovedAt: null,
      sponsorshipLastSponsoredAt: null,
      isActive: jest.fn(() => true),
      save: jest.fn(async function save() {
        return this;
      }),
    };
  });

  it('applies sponsorship and stores the approved budget', async () => {
    const result = await applyForSponsorship(user, { requestedBudgetStroops: 2400 });

    expect(user.sponsorshipEnabled).toBe(true);
    expect(user.sponsorshipStatus).toBe('approved');
    expect(user.sponsorshipBudgetLimitStroops).toBe(2400);
    expect(user.save).toHaveBeenCalled();
    expect(result.remainingBudgetStroops).toBe(2400);
  });

  it('reports ineligible users when sponsorship is not approved', () => {
    const eligibility = checkSponsorshipEligibility(user, 1000);

    expect(eligibility.eligible).toBe(false);
    expect(eligibility.reasons).toContain('User has not enabled sponsorship');
    expect(eligibility.reasons).toContain('User sponsorship status is inactive');
  });

  it('returns remaining budget from the effective budget limit', () => {
    user.sponsorshipEnabled = true;
    user.sponsorshipStatus = 'approved';
    user.sponsorshipBudgetLimitStroops = 4000;
    user.sponsorshipBudgetUsedStroops = 1500;

    expect(getRemainingBudget(user)).toBe(2500);
    expect(getSponsorshipStatus(user).remainingBudgetStroops).toBe(2500);
  });

  it('executes a sponsored transaction and tracks spend', async () => {
    user.sponsorshipEnabled = true;
    user.sponsorshipStatus = 'approved';
    user.sponsorshipBudgetLimitStroops = 3000;

    submitFeeBumpTransaction.mockResolvedValue({
      success: true,
      hash: 'abc123',
      status: 'PENDING',
      feeBumpXdr: 'AAAA',
    });

    const result = await executeSponsoredTransaction(user, {
      transactionXdr: 'AAAAINNERXDR',
      feeStroops: 1200,
    });

    expect(submitFeeBumpTransaction).toHaveBeenCalledWith({
      innerTransactionXdr: 'AAAAINNERXDR',
      sponsorSecretKey: 'SPLATFORMSECRET',
      baseFeeStroops: 1200,
      networkPassphrase: 'Test SDF Network ; September 2015',
    });
    expect(user.sponsorshipBudgetUsedStroops).toBe(1200);
    expect(user.save).toHaveBeenCalled();
    expect(result.hash).toBe('abc123');
    expect(result.sponsorship.remainingBudgetStroops).toBe(1800);
  });
});
