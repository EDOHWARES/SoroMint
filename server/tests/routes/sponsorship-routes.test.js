jest.mock('../../middleware/auth', () => ({
  authenticate: jest.fn((req, res, next) => {
    req.user = {
      _id: 'user-1',
      publicKey: 'GDZYF2MVD4MMJIDNVTVCKRWP7F55N56CGKUCLH7SZ7KJQLGMMFMNVOVP',
      role: 'user',
      isActive: () => true,
    };
    next();
  }),
}));

const request = require('supertest');
const express = require('express');
const { errorHandler } = require('../../middleware/error-handler');
const { createSponsorshipRouter } = require('../../routes/sponsorship-routes');

let app;
let serviceMocks;

beforeEach(() => {
  serviceMocks = {
    applyForSponsorship: jest.fn(async (user) => ({
      status: 'approved',
      publicKey: user.publicKey,
      remainingBudgetStroops: 2500,
    })),
    getSponsorshipStatus: jest.fn(async () => ({
      status: 'approved',
      remainingBudgetStroops: 2500,
    })),
    executeSponsoredTransaction: jest.fn(async () => ({
      hash: 'tx-hash',
      status: 'PENDING',
      sponsoredFeeStroops: 900,
    })),
  };

  app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.correlationId = 'test-correlation-id';
    next();
  });
  app.use('/api/sponsorship', createSponsorshipRouter(serviceMocks));
  app.use(errorHandler);
});

describe('sponsorship-routes', () => {
  it('applies for sponsorship for an authenticated user', async () => {
    const response = await request(app)
      .post('/api/sponsorship/apply')
      .send({ requestedBudgetStroops: 2500 });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.status).toBe('approved');
    expect(serviceMocks.applyForSponsorship).toHaveBeenCalled();
  });

  it('returns sponsorship status for an authenticated user', async () => {
    const response = await request(app).get('/api/sponsorship/status');

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.remainingBudgetStroops).toBe(2500);
  });

  it('executes a sponsored transaction', async () => {
    const response = await request(app)
      .post('/api/sponsorship/execute')
      .send({
        transactionXdr: 'AAAAINNERXDR',
        feeStroops: 900,
      });

    expect(response.status).toBe(202);
    expect(response.body.success).toBe(true);
    expect(response.body.data.hash).toBe('tx-hash');
    expect(serviceMocks.executeSponsoredTransaction).toHaveBeenCalledWith(
      expect.objectContaining({ publicKey: expect.any(String) }),
      { transactionXdr: 'AAAAINNERXDR', feeStroops: 900 }
    );
  });

  it('rejects execute requests without a transaction XDR', async () => {
    const response = await request(app)
      .post('/api/sponsorship/execute')
      .send({ feeStroops: 900 });

    expect(response.status).toBe(400);
    expect(response.body.code).toBe('VALIDATION_ERROR');
  });
});
