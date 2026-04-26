const redisClient = require('../config/redisClient');
const { REDIS_CACHE_TTL } = require('../config/env-config');
const logger = require('../utils/logger');

const TOKEN_METADATA_PREFIX = 'token:metadata:';

class MetadataCacheService {
    constructor(client, ttl) {
        this.redis = client;
        this.ttl = ttl || 3600; // Default to 1 hour
    }

    /**
     * Retrieves token metadata from the cache.
     * @param {string} tokenId - The unique identifier for the token.
     * @returns {Promise<object|null>} The parsed metadata object or null if not found.
     */
    async getMetadata(tokenId) {
        if (!this.redis || !this.redis.get) return null;
        const key = `${TOKEN_METADATA_PREFIX}${tokenId}`;
        try {
            const data = await this.redis.get(key);
            if (data) {
                logger.debug(`Cache HIT for key: ${key}`);
                return JSON.parse(data);
            }
            logger.debug(`Cache MISS for key: ${key}`);
            return null;
        } catch (error) {
            logger.error(`Error getting data from Redis for key ${key}:`, error);
            return null;
        }
    }

    /**
     * Stores token metadata in the cache with a TTL.
     * @param {string} tokenId - The unique identifier for the token.
     * @param {object} metadata - The metadata object to store.
     */
    async setMetadata(tokenId, metadata) {
        if (!this.redis || !this.redis.set) return;
        const key = `${TOKEN_METADATA_PREFIX}${tokenId}`;
        try {
            const value = JSON.stringify(metadata);
            await this.redis.set(key, value, 'EX', this.ttl);
            logger.debug(`Cache SET for key: ${key}`);
        } catch (error) {
            logger.error(`Error setting data in Redis for key ${key}:`, error);
        }
    }

    /**
     * Removes a token's metadata from the cache.
     * @param {string} tokenId - The unique identifier for the token.
     */
    async invalidateMetadata(tokenId) {
        if (!this.redis || !this.redis.del) return;
        const key = `${TOKEN_METADATA_PREFIX}${tokenId}`;
        try {
            await this.redis.del(key);
            logger.info(`Cache INVALIDATED for key: ${key}`);
        } catch (error) {
            logger.error(`Error invalidating Redis key ${key}:`, error);
        }
    }
}

module.exports = new MetadataCacheService(redisClient, REDIS_CACHE_TTL);