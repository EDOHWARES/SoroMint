const request = require('supertest');
const express = require('express');
const discoveryRoutes = require('../../routes/discovery-routes');
const Stream = require('../../models/Stream');

jest.mock('../../models/Stream');

const app = express();
app.use(express.json());
app.use('/api', discoveryRoutes);

describe('Discovery Routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('GET /api/discovery/streams', () => {
    it('should return only public active streams', async () => {
      const mockStreams = [
        { streamId: '1', isPublic: true, status: 'active' }
      ];
      Stream.find.mockReturnValue({
        sort: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        lean: jest.fn().mockResolvedValue(mockStreams)
      });
      Stream.countDocuments.mockResolvedValue(1);

      const res = await request(app).get('/api/discovery/streams');
      
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.length).toBe(1);
      expect(res.body.data[0].streamId).toBe('1');
      expect(Stream.find).toHaveBeenCalledWith({ isPublic: true, status: 'active' });
    });

    it('should sort by featured first, then by date', async () => {
      const mockSort = jest.fn().mockReturnThis();
      Stream.find.mockReturnValue({
        sort: mockSort,
        skip: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        lean: jest.fn().mockResolvedValue([])
      });
      Stream.countDocuments.mockResolvedValue(0);

      await request(app).get('/api/discovery/streams');
      
      expect(mockSort).toHaveBeenCalledWith({ isFeatured: -1, createdAt: -1 });
    });

    it('should handle pagination', async () => {
      const mockSkip = jest.fn().mockReturnThis();
      const mockLimit = jest.fn().mockReturnThis();
      Stream.find.mockReturnValue({
        sort: jest.fn().mockReturnThis(),
        skip: mockSkip,
        limit: mockLimit,
        lean: jest.fn().mockResolvedValue([])
      });
      Stream.countDocuments.mockResolvedValue(25);

      const res = await request(app).get('/api/discovery/streams?limit=10&page=2');
      
      expect(res.body.metadata.page).toBe(2);
      expect(mockSkip).toHaveBeenCalledWith(10);
      expect(mockLimit).toHaveBeenCalledWith(10);
    });

    it('should return 400 for invalid query parameters', async () => {
        const res = await request(app).get('/api/discovery/streams?page=invalid');
        expect(res.status).toBe(400);
        expect(res.body.error).toBe('Invalid query parameters');
    });
  });
});
