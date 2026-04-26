const Redis = require('ioredis-mock');
const MetadataCacheService = require('../../services/cacheService');

describe('MetadataCacheService', () => {
    let redisClient;
    let cacheService;
    const TTL = 3600;

    beforeEach(() => {
        // Create a new mock instance for each test to ensure isolation
        redisClient = new Redis();
        // We instantiate the class directly for testing instead of using the singleton
        cacheService = new MetadataCacheService(redisClient, TTL);
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    describe('getMetadata', () => {
        it('should return parsed data on a cache hit', async () => {
            const tokenId = 'test-id-hit';
            const metadata = { name: 'SoroMint', symbol: 'SORO' };
            await redisClient.set(`token:metadata:${tokenId}`, JSON.stringify(metadata));

            const result = await cacheService.getMetadata(tokenId);

            expect(result).toEqual(metadata);
        });

        it('should return null on a cache miss', async () => {
            const tokenId = 'test-id-miss';
            const result = await cacheService.getMetadata(tokenId);
            expect(result).toBeNull();
        });
    });

    describe('setMetadata', () => {
        it('should set data in Redis with the correct key, value, and TTL', async () => {
            const tokenId = 'test-id-set';
            const metadata = { name: 'Test Token', symbol: 'TEST' };
            const key = `token:metadata:${tokenId}`;

            // Spy on the redis client's 'set' method
            const setSpy = jest.spyOn(redisClient, 'set');

            await cacheService.setMetadata(tokenId, metadata);

            // Verify set was called correctly
            expect(setSpy).toHaveBeenCalledWith(
                key,
                JSON.stringify(metadata),
                'EX',
                TTL
            );

            // Verify the data was actually set
            const storedValue = await redisClient.get(key);
            expect(JSON.parse(storedValue)).toEqual(metadata);
        });
    });

    describe('invalidateMetadata', () => {
        it('should delete the correct key from Redis', async () => {
            const tokenId = 'test-id-invalidate';
            const key = `token:metadata:${tokenId}`;
            await redisClient.set(key, JSON.stringify({ data: 'stale' }));

            // Ensure data exists before invalidation
            expect(await redisClient.get(key)).toBeDefined();

            await cacheService.invalidateMetadata(tokenId);

            // Ensure data is gone after invalidation
            expect(await redisClient.get(key)).toBeNull();
        });
    });
});