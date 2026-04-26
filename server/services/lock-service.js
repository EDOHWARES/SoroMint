const { getCacheService } = require('./cache-service');
const { logger } = require('../utils/logger');
const crypto = require('crypto');

/**
 * @title Lock Service
 * @notice Provides distributed locking using Redis (Redlock pattern for single node)
 * @dev Used to prevent race conditions in concurrent operations
 */
class LockService {
  constructor() {
    // Lua script to safely release a lock only if the value matches
    // This prevents releasing a lock that expired and was acquired by someone else
    this.releaseScript = `
      if redis.call("get", KEYS[1]) == ARGV[1] then
        return redis.call("del", KEYS[1])
      else
        return 0
      end
    `;
  }

  get client() {
    const cacheService = getCacheService();
    if (!cacheService.isHealthy()) {
      throw new Error('Redis cache is not connected, cannot acquire lock');
    }
    return cacheService.client;
  }

  /**
   * Helper function to pause execution
   * @param {number} ms 
   */
  async sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * @notice Attempts to acquire a distributed lock
   * @param {string} resource - The resource identifier to lock (e.g., public key)
   * @param {number} ttl - Lock time-to-live in milliseconds
   * @param {number} retries - Number of times to retry acquiring the lock
   * @param {number} retryDelay - Base delay between retries in milliseconds
   * @returns {Promise<string|null>} Lock value if successful, null if failed
   */
  async acquireLock(resource, ttl = 30000, retries = 5, retryDelay = 2000) {
    const lockKey = `lock:${resource}`;
    const lockValue = crypto.randomBytes(16).toString('hex');
    
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        // NX: Set only if it does not exist
        // PX: Expire in TTL milliseconds
        const result = await this.client.set(lockKey, lockValue, {
          NX: true,
          PX: ttl
        });

        if (result === 'OK') {
          logger.debug('Lock acquired', { resource, attempt });
          return lockValue;
        }
        
        if (attempt < retries) {
          // Add some jitter to the retry delay to prevent thundering herd
          const jitter = Math.floor(Math.random() * 500);
          const currentDelay = retryDelay + jitter;
          logger.debug('Lock busy, waiting to retry', { resource, attempt, currentDelay });
          await this.sleep(currentDelay);
        }
      } catch (error) {
        logger.warn('Error during lock acquisition attempt', { resource, error: error.message });
        if (attempt === retries) throw error;
        await this.sleep(retryDelay);
      }
    }

    logger.warn('Failed to acquire lock after retries', { resource, retries });
    return null;
  }

  /**
   * @notice Releases an acquired lock
   * @param {string} resource - The resource identifier
   * @param {string} lockValue - The lock value returned from acquireLock
   * @returns {Promise<boolean>} True if released successfully, false otherwise
   */
  async releaseLock(resource, lockValue) {
    if (!lockValue) return false;
    
    const lockKey = `lock:${resource}`;
    
    try {
      // Execute the Lua script to safely release
      const result = await this.client.eval(
        this.releaseScript,
        {
          keys: [lockKey],
          arguments: [lockValue]
        }
      );
      
      const success = result === 1;
      if (success) {
        logger.debug('Lock released safely', { resource });
      } else {
        logger.debug('Lock release ignored, value mismatch or expired', { resource });
      }
      return success;
    } catch (error) {
      logger.error('Failed to execute lock release script', { resource, error: error.message });
      return false;
    }
  }
}

module.exports = new LockService();
