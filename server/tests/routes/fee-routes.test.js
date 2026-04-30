const request = require('supertest');
const express = require('express');

jest.mock('../../services/fee-service', () => ({
  getRecommendedFee: jest.fn(),
  getFeeSuggestions: jest.fn(),
}));
jest.mock('../../services/transaction-simulation-service', () => ({
  simulateTransactionEstimate: jest.fn(),
}));

const feeRoutes = require('../../routes/fee-routes');
const { errorHandler } = require('../../middleware/error-handler');
const { getFeeSuggestions } = require('../../services/fee-service');
const {
  simulateTransactionEstimate,
} = require('../../services/transaction-simulation-service');

let app;

beforeAll(() => {
  app = express();
  app.use(express.json());
  app.use('/api', feeRoutes);
  app.use(errorHandler);
});

describe('Fee Routes', () => {
  describe('GET /api/fees/suggestions', () => {
    it('should return fee suggestions', async () => {
      getFeeSuggestions.mockResolvedValueOnce({
        perOperationFee: { low: 100, medium: 200, high: 300 },
        totalFee: { low: 100, medium: 200, high: 300 },
        baseFee: 100,
        percentiles: { p10: 100, p50: 200, p90: 300, p99: 400 },
        surging: false,
        operationCount: 1,
        lastLedger: '12345',
        ledgerCapacityUsage: '0.8',
      });

      const response = await request(app).get('/api/fees/suggestions?ops=1');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.perOperationFee).toEqual({
        low: 100,
        medium: 200,
        high: 300,
      });
      expect(getFeeSuggestions).toHaveBeenCalledWith(1);
    });

    it('should validate ops parameter', async () => {
      const response = await request(app).get('/api/fees/suggestions?ops=0');
      expect(response.status).toBe(400);
      expect(response.body.code).toBe('INVALID_PARAMETER');
    });
  });

  describe('POST /api/fees/simulate', () => {
    it('should simulate a transaction and return fee estimates in XLM', async () => {
      simulateTransactionEstimate.mockResolvedValueOnce({
        latestLedger: 12345,
        resourceUsage: {
          cpuInsns: '1200000',
          memBytes: '4096',
        },
        execution: {
          result: { ok: true },
          auth: [],
          events: [],
          stateChanges: [],
        },
        fees: {
          inclusionFeeStroops: '100',
          inclusionFeeXlm: '0.00001',
          resourceFeeStroops: '2500',
          resourceFeeXlm: '0.00025',
          totalFeeStroops: '2600',
          totalFeeXlm: '0.00026',
        },
        transactionData: null,
        restorePreamble: null,
        raw: {
          minResourceFee: '2500',
          cost: {
            cpuInsns: '1200000',
            memBytes: '4096',
          },
        },
      });

      const response = await request(app)
        .post('/api/fees/simulate')
        .send({ transactionXdr: 'AAAAAg==' });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.fees.totalFeeXlm).toBe('0.00026');
      expect(simulateTransactionEstimate).toHaveBeenCalledWith('AAAAAg==');
    });

    it('should validate transactionXdr parameter', async () => {
      const response = await request(app).post('/api/fees/simulate').send({});

      expect(response.status).toBe(400);
      expect(response.body.code).toBe('INVALID_PARAMETER');
    });
  });
});
