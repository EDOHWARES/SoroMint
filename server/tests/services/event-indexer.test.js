const { SorobanEventIndexer } = require('../../services/event-indexer');
const SorobanEvent = require('../../models/SorobanEvent');
const mongoose = require('mongoose');

jest.mock('../../models/SorobanEvent');
jest.mock('@stellar/stellar-sdk');

describe('SorobanEventIndexer', () => {
  let indexer;

  beforeEach(() => {
    indexer = new SorobanEventIndexer();
    jest.clearAllMocks();
  });

  afterEach(() => {
    if (indexer.isRunning) {
      indexer.stop();
    }
  });

  describe('initialize', () => {
    it('should initialize with last cursor from database', async () => {
      const mockEvent = { pagingToken: '12345-1' };
      SorobanEvent.findOne = jest.fn().mockReturnValue({
        sort: jest.fn().mockResolvedValue(mockEvent),
      });

      await indexer.initialize();

      expect(indexer.lastCursor).toBe('12345-1');
    });

    it('should initialize with undefined cursor if no events exist', async () => {
      SorobanEvent.findOne = jest.fn().mockReturnValue({
        sort: jest.fn().mockResolvedValue(null),
      });

      await indexer.initialize();

      expect(indexer.lastCursor).toBeUndefined();
    });
  });

  describe('start/stop', () => {
    it('should set isRunning to true when started', () => {
      indexer.start();
      expect(indexer.isRunning).toBe(true);
      indexer.stop();
    });

    it('should set isRunning to false when stopped', () => {
      indexer.start();
      indexer.stop();
      expect(indexer.isRunning).toBe(false);
    });
  });
});
