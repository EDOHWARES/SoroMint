jest.mock('../../middleware/auth', () => ({
  authenticate: (req, res, next) => next(),
}));

jest.mock('../../utils/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

const express = require('express');
const request = require('supertest');
const SorobanEvent = require('../../models/SorobanEvent');
const eventRoutes = require('../../routes/soroban-event-routes');

describe('SorobanEvent routes', () => {
  beforeEach(() => {
    jest.restoreAllMocks();
  });

  it('uses a narrow projection when fetching events', async () => {
    const mockQuery = {
      select: jest.fn().mockReturnThis(),
      sort: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue([]),
    };

    jest.spyOn(SorobanEvent, 'find').mockReturnValue(mockQuery);
    jest.spyOn(SorobanEvent, 'countDocuments').mockResolvedValue(0);

    const app = express();
    app.use('/api', eventRoutes);

    await request(app).get('/api/events').query({ contractId: 'contract-123' });

    expect(SorobanEvent.find).toHaveBeenCalledWith({ contractId: 'contract-123' });
    expect(mockQuery.select).toHaveBeenCalledWith(
      expect.stringContaining('contractId')
    );
  });

  it('applies match before grouping stats', async () => {
    jest.spyOn(SorobanEvent, 'aggregate').mockResolvedValue([]);

    const app = express();
    app.use('/api', eventRoutes);

    await request(app).get('/api/events/stats').query({ contractId: 'contract-123' });

    expect(SorobanEvent.aggregate).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ $match: { contractId: 'contract-123' } }),
      ])
    );
  });
});
