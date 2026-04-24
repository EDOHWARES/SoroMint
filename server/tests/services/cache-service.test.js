/**
 * @title Cache Service Tests
 * @description Test suite for Redis cache service
 */

const { CacheService } = require('../../services/cache-service');
const redis = require('redis');

// Mock Redis client
jest.mock('redis', () => ({
    createClient: jest.fn(),
}));

describe('CacheService', () => {
    let cacheService;
    let mockRedisClient;

    beforeEach(() => {
        // Create a mock Redis client
        mockRedisClient = {
            connect: jest.fn().mockResolvedValue(undefined),
            on: jest.fn(),
            get: jest.fn(),
            setEx: jest.fn(),
            del: jest.fn(),
            keys: jest.fn(),
            flushDb: jest.fn(),
            quit: jest.fn().mockResolvedValue(undefined),
            info: jest.fn().mockResolvedValue('# Server\nredis_version:7.0.0'),
        };

        redis.createClient.mockReturnValue(mockRedisClient);

        cacheService = new CacheService();
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    describe('initialize', () => {
        it('should initialize Redis connection successfully', async () => {
            await cacheService.initialize();

            expect(redis.createClient).toHaveBeenCalled();
            expect(mockRedisClient.connect).toHaveBeenCalled();
            expect(cacheService.isConnected).toBe(true);
        });

        it('should handle initialization errors gracefully', async () => {
            const error = new Error('Connection failed');
            mockRedisClient.connect.mockRejectedValueOnce(error);

            await expect(cacheService.initialize()).rejects.toThrow('Connection failed');
            expect(cacheService.isConnected).toBe(false);
        });

        it('should register event listeners', async () => {
            await cacheService.initialize();

            expect(mockRedisClient.on).toHaveBeenCalledWith('error', expect.any(Function));
            expect(mockRedisClient.on).toHaveBeenCalledWith('connect', expect.any(Function));
            expect(mockRedisClient.on).toHaveBeenCalledWith('ready', expect.any(Function));
            expect(mockRedisClient.on).toHaveBeenCalledWith('reconnecting', expect.any(Function));
        });
    });

    describe('get', () => {
        beforeEach(async () => {
            await cacheService.initialize();
        });

        it('should return cached value when key exists', async () => {
            const cachedData = { name: 'Test Token', symbol: 'TST' };
            mockRedisClient.get.mockResolvedValueOnce(JSON.stringify(cachedData));

            const result = await cacheService.get('test:key');

            expect(result).toEqual(cachedData);
            expect(mockRedisClient.get).toHaveBeenCalledWith('test:key');
        });

        it('should return null when key does not exist', async () => {
            mockRedisClient.get.mockResolvedValueOnce(null);

            const result = await cacheService.get('nonexistent:key');

            expect(result).toBeNull();
        });

        it('should handle get errors gracefully', async () => {
            mockRedisClient.get.mockRejectedValueOnce(new Error('Redis error'));

            const result = await cacheService.get('test:key');

            expect(result).toBeNull();
        });

        it('should return null when disconnected', async () => {
            cacheService.isConnected = false;

            const result = await cacheService.get('test:key');

            expect(result).toBeNull();
        });
    });

    describe('set', () => {
        beforeEach(async () => {
            await cacheService.initialize();
        });

        it('should set value with default TTL', async () => {
            const testData = { name: 'Test' };
            mockRedisClient.setEx.mockResolvedValueOnce('OK');

            await cacheService.set('test:key', testData);

            expect(mockRedisClient.setEx).toHaveBeenCalledWith(
                'test:key',
                3600,
                JSON.stringify(testData)
            );
        });

        it('should set value with custom TTL', async () => {
            const testData = { name: 'Test' };
            mockRedisClient.setEx.mockResolvedValueOnce('OK');

            await cacheService.set('test:key', testData, 7200);

            expect(mockRedisClient.setEx).toHaveBeenCalledWith(
                'test:key',
                7200,
                JSON.stringify(testData)
            );
        });

        it('should handle set errors gracefully', async () => {
            mockRedisClient.setEx.mockRejectedValueOnce(new Error('Redis error'));

            await expect(cacheService.set('test:key', { name: 'Test' })).resolves.toBeUndefined();
        });

        it('should not set when disconnected', async () => {
            cacheService.isConnected = false;

            await cacheService.set('test:key', { name: 'Test' });

            expect(mockRedisClient.setEx).not.toHaveBeenCalled();
        });
    });

    describe('delete', () => {
        beforeEach(async () => {
            await cacheService.initialize();
        });

        it('should delete a key successfully', async () => {
            mockRedisClient.del.mockResolvedValueOnce(1);

            const result = await cacheService.delete('test:key');

            expect(result).toBe(1);
            expect(mockRedisClient.del).toHaveBeenCalledWith('test:key');
        });

        it('should return 0 when key does not exist', async () => {
            mockRedisClient.del.mockResolvedValueOnce(0);

            const result = await cacheService.delete('nonexistent:key');

            expect(result).toBe(0);
        });

        it('should handle delete errors gracefully', async () => {
            mockRedisClient.del.mockRejectedValueOnce(new Error('Redis error'));

            const result = await cacheService.delete('test:key');

            expect(result).toBe(0);
        });

        it('should return 0 when disconnected', async () => {
            cacheService.isConnected = false;

            const result = await cacheService.delete('test:key');

            expect(result).toBe(0);
        });
    });

    describe('deleteByPattern', () => {
        beforeEach(async () => {
            await cacheService.initialize();
        });

        it('should delete multiple keys matching a pattern', async () => {
            mockRedisClient.keys.mockResolvedValueOnce(['tokens:owner:key1', 'tokens:owner:key2']);
            mockRedisClient.del.mockResolvedValueOnce(2);

            const result = await cacheService.deleteByPattern('tokens:owner:*');

            expect(result).toBe(2);
            expect(mockRedisClient.keys).toHaveBeenCalledWith('tokens:owner:*');
        });

        it('should handle multiple patterns', async () => {
            mockRedisClient.keys
                .mockResolvedValueOnce(['tokens:owner:key1'])
                .mockResolvedValueOnce(['tokens:user:key2']);
            mockRedisClient.del.mockResolvedValue(1);

            const result = await cacheService.deleteByPattern(['tokens:owner:*', 'tokens:user:*']);

            expect(result).toBe(2);
        });

        it('should return 0 when no keys match pattern', async () => {
            mockRedisClient.keys.mockResolvedValueOnce([]);

            const result = await cacheService.deleteByPattern('nonexistent:*');

            expect(result).toBe(0);
        });

        it('should return 0 when disconnected', async () => {
            cacheService.isConnected = false;

            const result = await cacheService.deleteByPattern('tokens:owner:*');

            expect(result).toBe(0);
        });
    });

    describe('clear', () => {
        beforeEach(async () => {
            await cacheService.initialize();
        });

        it('should clear all cache', async () => {
            mockRedisClient.flushDb.mockResolvedValueOnce('OK');

            await cacheService.clear();

            expect(mockRedisClient.flushDb).toHaveBeenCalled();
        });

        it('should handle clear errors gracefully', async () => {
            mockRedisClient.flushDb.mockRejectedValueOnce(new Error('Redis error'));

            await expect(cacheService.clear()).resolves.toBeUndefined();
        });

        it('should not clear when disconnected', async () => {
            cacheService.isConnected = false;

            await cacheService.clear();

            expect(mockRedisClient.flushDb).not.toHaveBeenCalled();
        });
    });

    describe('getOrSet', () => {
        beforeEach(async () => {
            await cacheService.initialize();
        });

        it('should return cached data on cache hit', async () => {
            const cachedData = { name: 'Token' };
            mockRedisClient.get.mockResolvedValueOnce(JSON.stringify(cachedData));

            const fetchFunction = jest.fn();
            const result = await cacheService.getOrSet('test:key', fetchFunction);

            expect(result).toEqual(cachedData);
            expect(fetchFunction).not.toHaveBeenCalled();
        });

        it('should fetch and cache data on cache miss', async () => {
            mockRedisClient.get.mockResolvedValueOnce(null);
            mockRedisClient.setEx.mockResolvedValueOnce('OK');

            const fetchData = { name: 'Token' };
            const fetchFunction = jest.fn().mockResolvedValueOnce(fetchData);

            const result = await cacheService.getOrSet('test:key', fetchFunction);

            expect(result).toEqual(fetchData);
            expect(fetchFunction).toHaveBeenCalled();
            expect(mockRedisClient.setEx).toHaveBeenCalled();
        });

        it('should respect custom TTL option', async () => {
            mockRedisClient.get.mockResolvedValueOnce(null);
            mockRedisClient.setEx.mockResolvedValueOnce('OK');

            const fetchData = { name: 'Token' };
            const fetchFunction = jest.fn().mockResolvedValueOnce(fetchData);

            await cacheService.getOrSet('test:key', fetchFunction, { ttl: 1800 });

            expect(mockRedisClient.setEx).toHaveBeenCalledWith(
                'test:key',
                1800,
                JSON.stringify(fetchData)
            );
        });

        it('should return fresh data on cache operation failure', async () => {
            mockRedisClient.get.mockRejectedValueOnce(new Error('Redis error'));

            const fetchData = { name: 'Token' };
            const fetchFunction = jest.fn().mockResolvedValueOnce(fetchData);

            const result = await cacheService.getOrSet('test:key', fetchFunction);

            expect(result).toEqual(fetchData);
        });
    });

    describe('isHealthy', () => {
        it('should return true when connected', async () => {
            await cacheService.initialize();

            expect(cacheService.isHealthy()).toBe(true);
        });

        it('should return false when disconnected', () => {
            cacheService.isConnected = false;
            cacheService.client = null;

            expect(cacheService.isHealthy()).toBe(false);
        });
    });

    describe('getHealth', () => {
        it('should return healthy status when connected', async () => {
            await cacheService.initialize();
            mockRedisClient.info.mockResolvedValueOnce('# Server\nredis_version:7.0.0');

            const health = await cacheService.getHealth();

            expect(health.status).toBe('healthy');
            expect(health.connected).toBe(true);
        });

        it('should return disconnected status when not connected', async () => {
            const health = await cacheService.getHealth();

            expect(health.status).toBe('disconnected');
            expect(health.connected).toBe(false);
        });

        it('should handle health check errors', async () => {
            await cacheService.initialize();
            mockRedisClient.info.mockRejectedValueOnce(new Error('Health check failed'));

            const health = await cacheService.getHealth();

            expect(health.status).toBe('unhealthy');
            expect(health.connected).toBe(false);
        });
    });

    describe('close', () => {
        beforeEach(async () => {
            await cacheService.initialize();
        });

        it('should close Redis connection', async () => {
            await cacheService.close();

            expect(mockRedisClient.quit).toHaveBeenCalled();
            expect(cacheService.isConnected).toBe(false);
        });

        it('should handle close errors gracefully', async () => {
            mockRedisClient.quit.mockRejectedValueOnce(new Error('Close failed'));

            await expect(cacheService.close()).rejects.toThrow('Close failed');
        });
    });
});
