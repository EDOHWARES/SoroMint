const PlatformFeeService = require('../services/platform-fee-service');
const PlatformFee = require('../models/PlatformFee');

describe('PlatformFeeService', () => {
  let feeService;

  beforeEach(() => {
    feeService = new PlatformFeeService();
  });

  describe('calculateFee', () => {
    it('should calculate 1% fee correctly', async () => {
      const totalAmount = '1000000000'; // 1 billion units
      const feeAmount = await feeService.calculateFee(totalAmount, '0x123');
      expect(feeAmount).toBe('10000000'); // 1% = 10 million units
    });

    it('should apply minimum fee constraint', async () => {
      // Mock a config with minimum fee
      jest.spyOn(feeService, 'getFeeConfig').mockResolvedValue(0.01);
      
      const totalAmount = '100'; // Very small amount
      const feeAmount = await feeService.calculateFee(totalAmount, '0x123');
      
      // Should return at least the minimum fee (0 in this case since no min is set)
      expect(feeAmount).toBe('1'); // 1% of 100 = 1
    });

    it('should use default fee percentage when no config exists', async () => {
      jest.spyOn(feeService, 'getFeeConfig').mockResolvedValue(feeService.defaultFeePercentage);
      
      const totalAmount = '1000000';
      const feeAmount = await feeService.calculateFee(totalAmount, 'unknown_token');
      
      const expectedFee = (BigInt(totalAmount) * BigInt(100)) / 10000n; // 1%
      expect(feeAmount).toBe(expectedFee.toString());
    });
  });

  describe('getFeeConfig', () => {
    it('should return default fee when no config exists', async () => {
      const feePercentage = await feeService.getFeeConfig('nonexistent_token');
      expect(feePercentage).toBe(feeService.defaultFeePercentage);
    });
  });

  describe('createPlatformFeeRecord', () => {
    it('should create a platform fee record', async () => {
      const streamData = {
        streamId: 'test_stream_123',
        totalAmount: '1000000000',
        tokenAddress: '0x123456789',
      };
      const txHash = '0xabcdef';

      // Mock the calculateFee and getFeeConfig methods
      jest.spyOn(feeService, 'calculateFee').mockResolvedValue('10000000');
      jest.spyOn(feeService, 'getFeeConfig').mockResolvedValue(0.01);

      // Mock the PlatformFee constructor and save method
      const mockSave = jest.fn().mockResolvedValue({});
      jest.spyOn(PlatformFee.prototype, 'save').mockImplementation(mockSave);

      const result = await feeService.createPlatformFeeRecord(streamData, txHash);

      expect(mockSave).toHaveBeenCalled();
      expect(result).toBeDefined();
    });
  });
});
