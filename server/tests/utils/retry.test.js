jest.mock('../../utils/logger', () => ({
  logger: { warn: jest.fn(), error: jest.fn() },
}));

const { retryWithBackoff } = require('../../utils/retry');
const { logger } = require('../../utils/logger');

beforeEach(() => {
  jest.clearAllMocks();
});

describe('retryWithBackoff', () => {
  test('resolves immediately on first success', async () => {
    const fn = jest.fn().mockResolvedValue('ok');
    const result = await retryWithBackoff(fn, { label: 'test' });
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  test('retries on failure and succeeds on second attempt', async () => {
    const fn = jest.fn()
      .mockRejectedValueOnce(new Error('transient'))
      .mockResolvedValueOnce('recovered');

    // Use tiny delay so test doesn't take long
    const result = await retryWithBackoff(fn, { maxRetries: 2, baseDelayMs: 1, label: 'test' });

    expect(result).toBe('recovered');
    expect(fn).toHaveBeenCalledTimes(2);
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('test failed, retrying in 1ms'),
      expect.objectContaining({ attempt: 1, maxRetries: 2 })
    );
  });

  test('throws after exhausting all retries', async () => {
    const fn = jest.fn().mockRejectedValue(new Error('permanent'));

    await expect(
      retryWithBackoff(fn, { maxRetries: 3, baseDelayMs: 1, label: 'test' })
    ).rejects.toThrow('permanent');

    expect(fn).toHaveBeenCalledTimes(4); // 1 initial + 3 retries
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('test failed permanently after 4 attempts'),
      expect.objectContaining({ error: 'permanent' })
    );
  });

  test('uses exponential backoff delays', async () => {
    const delays = [];
    const spy = jest.spyOn(global, 'setTimeout').mockImplementation((cb, ms) => {
      delays.push(ms);
      return setImmediate(cb); // execute immediately without real delay
    });

    const fn = jest.fn()
      .mockRejectedValueOnce(new Error('e1'))
      .mockRejectedValueOnce(new Error('e2'))
      .mockResolvedValueOnce('done');

    const result = await retryWithBackoff(fn, { maxRetries: 3, baseDelayMs: 1000, label: 'test' });

    expect(result).toBe('done');
    expect(delays).toEqual([1000, 2000]); // 1s then 2s
    spy.mockRestore();
  });

  test('uses default options when none provided', async () => {
    const fn = jest.fn().mockResolvedValue('default');
    const result = await retryWithBackoff(fn);
    expect(result).toBe('default');
  });
});
