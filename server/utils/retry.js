const { logger } = require('./logger');

const DEFAULT_MAX_RETRIES = 4;
const DEFAULT_BASE_DELAY_MS = 1000;

/**
 * Retries an async function with exponential backoff.
 * Delays: 1s, 2s, 4s, 8s (by default).
 *
 * @param {Function} fn - Async function to execute.
 * @param {Object} [options]
 * @param {number} [options.maxRetries=4] - Maximum number of retry attempts.
 * @param {number} [options.baseDelayMs=1000] - Base delay in ms (doubles each retry).
 * @param {string} [options.label='RPC call'] - Label for log messages.
 * @returns {Promise<any>} Result of fn on success.
 * @throws {Error} Last error after all retries are exhausted.
 */
const retryWithBackoff = async (fn, { maxRetries = DEFAULT_MAX_RETRIES, baseDelayMs = DEFAULT_BASE_DELAY_MS, label = 'RPC call' } = {}) => {
  let lastError;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      if (attempt === maxRetries) {
        logger.error(`${label} failed permanently after ${maxRetries + 1} attempts`, {
          error: error.message,
        });
        break;
      }

      const delay = baseDelayMs * Math.pow(2, attempt);
      logger.warn(`${label} failed, retrying in ${delay}ms`, {
        attempt: attempt + 1,
        maxRetries,
        error: error.message,
      });

      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  throw lastError;
};

module.exports = { retryWithBackoff };
