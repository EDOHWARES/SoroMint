const {
  computeFeeSuggestions,
  computeRecommendedFee,
} = require('../../services/fee-service');

describe('Fee Service', () => {
  describe('computeFeeSuggestions', () => {
    it('should return low/medium/high totals based on percentiles and ops', () => {
      const feeStats = {
        last_ledger_base_fee: '100',
        fee_charged: {
          p10: '100',
          p50: '120',
          p90: '180',
          p99: '250',
        },
        last_ledger: '12345',
        ledger_capacity_usage: '0.8',
      };

      const result = computeFeeSuggestions(feeStats, 2);

      expect(result.perOperationFee).toEqual({ low: 100, medium: 120, high: 180 });
      expect(result.totalFee).toEqual({ low: 200, medium: 240, high: 360 });
      expect(result.baseFee).toBe(100);
      expect(result.surging).toBe(false);
      expect(result.operationCount).toBe(2);
      expect(result.percentiles).toEqual({ p10: 100, p50: 120, p90: 180, p99: 250 });
    });

    it('should clamp suggestions to at least base fee', () => {
      const feeStats = {
        last_ledger_base_fee: '100',
        fee_charged: {
          p10: '50',
          p50: '75',
          p90: '90',
        },
      };

      const result = computeFeeSuggestions(feeStats, 1);
      expect(result.perOperationFee.low).toBe(100);
      expect(result.perOperationFee.medium).toBe(100);
      expect(result.perOperationFee.high).toBe(100);
    });

    it('should apply surge multiplier to high tier when surging', () => {
      const feeStats = {
        last_ledger_base_fee: '100',
        fee_charged: {
          p10: '100',
          p50: '120',
          p90: '250', // >= 2x base fee => surging
          p99: '400',
        },
      };

      const result = computeFeeSuggestions(feeStats, 1);

      expect(result.surging).toBe(true);
      // high = ceil(p90 * 1.5) = 375
      expect(result.perOperationFee.high).toBe(375);
      expect(result.totalFee.high).toBe(375);
    });
  });

  describe('computeRecommendedFee', () => {
    it('should use median fee when not surging', () => {
      const feeStats = {
        last_ledger_base_fee: '100',
        fee_charged: {
          p50: '150',
          p90: '180',
          p99: '250',
        },
      };

      const result = computeRecommendedFee(feeStats, 3);
      expect(result.surging).toBe(false);
      expect(result.perOperationFee).toBe(150);
      expect(result.recommended).toBe(450);
    });
  });
});
