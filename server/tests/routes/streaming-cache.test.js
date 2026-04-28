const request = require('supertest');
const express = require('express');
const streamingRoutes = require('../../routes/streaming-routes');
const StreamingService = require('../../services/streaming-service');
const { getCacheService } = require('../../services/cache-service');

// Mock StreamingService
jest.mock('../../services/streaming-service');
// Mock CacheService
jest.mock('../../services/cache-service');

let app;
let mockCache;
let mockStreamingService;

beforeAll(() => {
  app = express();
  app.use(express.json());
  // Mock sourceKeypair middleware
  app.use((req, res, next) => {
    req.sourceKeypair = { publicKey: () => 'GBZ4XGQW5X6V7Y2Z3A4B5C6D7E8F9G0H1I2J3K4L5M6N7O8P9Q0R1S2T' };
    next();
  });
  app.use('/api/streaming', streamingRoutes);

  mockCache = {
    getOrSet: jest.fn(),
    delete: jest.fn(),
  };
  getCacheService.mockReturnValue(mockCache);

  mockStreamingService = {
    getStreamBalance: jest.fn(),
    withdraw: jest.fn(),
    cancelStream: jest.fn(),
  };
  StreamingService.mockImplementation(() => mockStreamingService);
});

describe('Streaming Cache', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should use cache for balance lookups', async () => {
    const streamId = '1';
    const balance = { amount: '100' };
    
    mockCache.getOrSet.mockImplementation(async (key, fetchFn) => {
      return await fetchFn();
    });
    mockStreamingService.getStreamBalance.mockResolvedValue(balance);

    const response = await request(app)
      .get(`/api/streaming/streams/${streamId}/balance`);

    expect(response.status).toBe(200);
    expect(response.body.balance).toEqual(balance);
    expect(mockCache.getOrSet).toHaveBeenCalledWith(
      `stream:balance:${streamId}`,
      expect.any(Function),
      { ttl: 5 }
    );
  });

  it('should invalidate cache on withdrawal', async () => {
    const streamId = '1';
    mockStreamingService.withdraw.mockResolvedValue({ hash: 'tx_hash' });

    const response = await request(app)
      .post(`/api/streaming/streams/${streamId}/withdraw`)
      .send({ amount: '50' });

    expect(response.status).toBe(200);
    expect(mockCache.delete).toHaveBeenCalledWith(`stream:balance:${streamId}`);
  });

  it('should invalidate cache on cancellation', async () => {
    const streamId = '1';
    mockStreamingService.cancelStream.mockResolvedValue({ hash: 'tx_hash' });

    const response = await request(app)
      .delete(`/api/streaming/streams/${streamId}`);

    expect(response.status).toBe(200);
    expect(mockCache.delete).toHaveBeenCalledWith(`stream:balance:${streamId}`);
  });
});
