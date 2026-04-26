const redis = require('redis');
const { getEnv } = require('../config/env-config');
const { logger } = require('../utils/logger');

/**
 * @title Redis Cache Service
 * @description Manages caching of frequently accessed token metadata using Redis
 * @notice Implements cache-aside pattern with automatic TTL expiration
 * @dev Reduces database load and improves API response times
 */

class CacheService {
    /**
     * @notice Initializes the cache service with Redis client
     */
    constructor() {
        this.client = null;
        this.isConnected = false;
    }

    /**
     * @notice Initializes and connects to Redis
     * @dev Called during server startup
     * @returns {Promise<void>}
     */
    async initialize() {
        try {
            const env = getEnv();

            const redisConfig = {
                url: env.REDIS_URL,
                password: env.REDIS_PASSWORD || undefined,
                db: env.REDIS_DB,
                socket: {
                    reconnectStrategy: (retries) => {
                        if (retries > 10) {
                            logger.error('Redis: Max reconnection attempts reached');
                            return new Error('Redis max retries reached');
                        }
                        return retries * 50;
                    },
                },
            };

            this.client = redis.createClient(redisConfig);

            this.client.on('error', (err) => {
                logger.error('Redis client error', { error: err.message });
                this.isConnected = false;
            });

            this.client.on('connect', () => {
                logger.info('Redis cache connected successfully');
                this.isConnected = true;
            });

            this.client.on('ready', () => {
                logger.info('Redis cache ready');
            });

            this.client.on('reconnecting', () => {
                logger.warn('Redis cache reconnecting');
            });

            await this.client.connect();
            this.isConnected = true;
            logger.info('Cache service initialized successfully');
        } catch (error) {
            logger.error('Failed to initialize cache service', {
                error: error.message,
            });
            this.isConnected = false;
            throw error;
        }
    }

    /**
     * @notice Closes the Redis connection
     * @returns {Promise<void>}
     */
    async close() {
        if (this.client) {
            await this.client.quit();
            this.isConnected = false;
            logger.info('Cache service closed');
        }
    }

    /**
     * @notice Implements cache-aside pattern for retrieving cached data
     * @param {string} key - Cache key
     * @param {Function} fetchFunction - Function to execute if cache miss
     * @param {Object} options - Cache options
     * @param {number} options.ttl - Time-to-live in seconds (default: CACHE_TTL_METADATA from env)
     * @returns {Promise<any>} Cached or fetched data
     */
    async getOrSet(key, fetchFunction, options = {}) {
        try {
            // Attempt to get from cache
            const cachedData = await this.get(key);
            if (cachedData !== null) {
                logger.debug('Cache hit', { key });
                return cachedData;
            }

            // Cache miss - fetch from source
            logger.debug('Cache miss', { key });
            const data = await fetchFunction();

            // Store in cache
            const ttl = options.ttl || getEnv().CACHE_TTL_METADATA;
            await this.set(key, data, ttl);

            return data;
        } catch (error) {
            logger.error('Cache operation failed', {
                key,
                error: error.message,
            });
            // Return fresh data on cache failure
            return await fetchFunction();
        }
    }

    /**
     * @notice Gets a value from cache
     * @param {string} key - Cache key
     * @returns {Promise<any>} Cached value or null if not found
     */
    async get(key) {
        if (!this.isConnected || !this.client) {
            return null;
        }

        try {
            const value = await this.client.get(key);
            return value ? JSON.parse(value) : null;
        } catch (error) {
            logger.warn('Cache get operation failed', {
                key,
                error: error.message,
            });
            return null;
        }
    }

    /**
     * @notice Sets a value in cache with TTL
     * @param {string} key - Cache key
     * @param {any} value - Value to cache
     * @param {number} ttl - Time-to-live in seconds (default: CACHE_TTL_METADATA from env)
     * @returns {Promise<void>}
     */
    async set(key, value, ttl = null) {
        if (!this.isConnected || !this.client) {
            return;
        }

        try {
            const cacheTtl = ttl || getEnv().CACHE_TTL_METADATA;
            await this.client.setEx(key, cacheTtl, JSON.stringify(value));
            logger.debug('Cache set', { key, ttl: cacheTtl });
        } catch (error) {
            logger.warn('Cache set operation failed', {
                key,
                error: error.message,
            });
        }
    }

    /**
     * @notice Deletes a key from cache
     * @param {string} key - Cache key to delete
     * @returns {Promise<number>} Number of keys deleted
     */
    async delete(key) {
        if (!this.isConnected || !this.client) {
            return 0;
        }

        try {
            const result = await this.client.del(key);
            logger.debug('Cache invalidated', { key });
            return result;
        } catch (error) {
            logger.warn('Cache delete operation failed', {
                key,
                error: error.message,
            });
            return 0;
        }
    }

    /**
     * @notice Deletes multiple keys from cache using pattern matching
     * @param {string|string[]} pattern - Cache key pattern(s) to delete (supports *)
     * @returns {Promise<number>} Number of keys deleted
     */
    async deleteByPattern(pattern) {
        if (!this.isConnected || !this.client) {
            return 0;
        }

        try {
            const patterns = Array.isArray(pattern) ? pattern : [pattern];
            let totalDeleted = 0;

            for (const pat of patterns) {
                const keys = await this.client.keys(pat);
                if (keys.length > 0) {
                    totalDeleted += await this.client.del(keys);
                }
            }

            logger.debug('Cache pattern invalidated', { pattern, keysDeleted: totalDeleted });
            return totalDeleted;
        } catch (error) {
            logger.warn('Cache deleteByPattern operation failed', {
                pattern,
                error: error.message,
            });
            return 0;
        }
    }

    /**
     * @notice Clears all cache
     * @returns {Promise<void>}
     */
    async clear() {
        if (!this.isConnected || !this.client) {
            return;
        }

        try {
            await this.client.flushDb();
            logger.info('Cache cleared');
        } catch (error) {
            logger.warn('Cache clear operation failed', {
                error: error.message,
            });
        }
    }

    /**
     * @notice Checks if cache service is connected
     * @returns {boolean} Connection status
     */
    isHealthy() {
        return this.isConnected && this.client !== null;
    }

    /**
     * @notice Gets cache health status information
     * @returns {Promise<Object>} Health status with details
     */
    async getHealth() {
        try {
            if (!this.isConnected || !this.client) {
                return { status: 'disconnected', connected: false };
            }

            const info = await this.client.info();
            return {
                status: 'healthy',
                connected: true,
                info: info,
            };
        } catch (error) {
            logger.warn('Cache health check failed', {
                error: error.message,
            });
            return {
                status: 'unhealthy',
                connected: false,
                error: error.message,
            };
        }
    }
}

// Singleton instance
let cacheServiceInstance = null;

/**
 * @notice Gets or creates the cache service singleton
 * @returns {CacheService} Cache service instance
 */
function getCacheService() {
    if (!cacheServiceInstance) {
        cacheServiceInstance = new CacheService();
    }
    return cacheServiceInstance;
}

module.exports = {
    getCacheService,
    CacheService,
};
