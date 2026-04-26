const Redis = require('ioredis');
const logger = require('../utils/logger'); // Assuming a Winston logger exists at /utils/logger
const { REDIS_URL } = require('./env-config'); // Assuming env-config validates REDIS_URL

let client;

try {
    client = new Redis(REDIS_URL, {
        // Options to auto-reconnect
        maxRetriesPerRequest: 20,
        enableReadyCheck: true,
    });

    client.on('connect', () => {
        logger.info('Successfully connected to Redis.');
    });

    client.on('error', (err) => {
        logger.error('Redis connection error:', err);
    });
} catch (error) {
    logger.error('Could not create Redis client:', error);
}

module.exports = client;