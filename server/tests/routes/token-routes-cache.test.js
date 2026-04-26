/**
 * @title Token Routes Cache Integration Tests
 * @description Test suite for token routes with caching functionality
 */

const request = require('supertest');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const Token = require('../../../models/Token');
const DeploymentAudit = require('../../../models/DeploymentAudit');
const { createTokenRouter } = require('../../../routes/token-routes');
const { getCacheService } = require('../../../services/cache-service');
const express = require('express');

// Mock cache service
jest.mock('../../services/cache-service');

let mongoServer;
let app;
let cacheService;

const mockUser = {
    _id: new mongoose.Types.ObjectId(),
    username: 'testuser',
};

const mockAuth = (req, res, next) => {
    req.user = mockUser;
    req.correlationId = 'test-correlation-id';
    next();
};

describe('Token Routes with Cache Integration', () => {
    beforeAll(async () => {
        mongoServer = await MongoMemoryServer.create();
        const mongoUri = mongoServer.getUri();
        await mongoose.connect(mongoUri);
    });

    afterAll(async () => {
        await mongoose.disconnect();
        await mongoServer.stop();
    });

    beforeEach(async () => {
        // Clear collections
        await Token.deleteMany({});
        await DeploymentAudit.deleteMany({});

        // Setup mock cache service
        cacheService = {
            get: jest.fn(),
            set: jest.fn(),
            delete: jest.fn(),
            deleteByPattern: jest.fn(),
            isHealthy: jest.fn(() => true),
        };

        getCacheService.mockReturnValue(cacheService);

        // Create test app
        app = express();
        app.use(express.json());
        app.use(mockAuth);
        app.use('/api', createTokenRouter());
    });

    describe('GET /api/tokens/:owner - Cache Layer', () => {
        it('should return cached data on cache hit', async () => {
            const cachedTokens = [
                {
                    _id: new mongoose.Types.ObjectId(),
                    name: 'Cached Token',
                    symbol: 'CTK',
                    contractId: 'CA123',
                    ownerPublicKey: 'GUSER123',
                    decimals: 7,
                },
            ];

            const cachedResult = {
                data: cachedTokens,
                metadata: {
                    totalCount: 1,
                    page: 1,
                    totalPages: 1,
                    limit: 20,
                    search: null,
                },
            };

            cacheService.get.mockResolvedValueOnce(cachedResult);

            const response = await request(app)
                .get('/api/tokens/GUSER123')
                .query({ page: 1, limit: 20 });

            expect(response.status).toBe(200);
            expect(response.body.cached).toBe(true);
            expect(response.body.data).toEqual(cachedTokens);
            expect(cacheService.get).toHaveBeenCalledWith('tokens:owner:GUSER123:page:1:limit:20:search:none');
        });

        it('should fetch from database and cache on cache miss', async () => {
            const token = new Token({
                name: 'Test Token',
                symbol: 'TST',
                contractId: 'CA456',
                ownerPublicKey: 'GUSER456',
                decimals: 7,
            });
            await token.save();

            cacheService.get.mockResolvedValueOnce(null);
            cacheService.set.mockResolvedValueOnce(undefined);

            const response = await request(app)
                .get('/api/tokens/GUSER456')
                .query({ page: 1, limit: 20 });

            expect(response.status).toBe(200);
            expect(response.body.cached).toBe(false);
            expect(response.body.data).toHaveLength(1);
            expect(response.body.data[0].name).toBe('Test Token');
            expect(cacheService.set).toHaveBeenCalled();
        });

        it('should handle cache service failure gracefully', async () => {
            const token = new Token({
                name: 'Test Token',
                symbol: 'TST',
                contractId: 'CA789',
                ownerPublicKey: 'GUSER789',
                decimals: 7,
            });
            await token.save();

            cacheService.get.mockRejectedValueOnce(new Error('Cache error'));

            const response = await request(app)
                .get('/api/tokens/GUSER789')
                .query({ page: 1, limit: 20 });

            expect(response.status).toBe(200);
            expect(response.body.data).toHaveLength(1);
            expect(response.body.data[0].name).toBe('Test Token');
        });

        it('should cache different search queries separately', async () => {
            const token1 = new Token({
                name: 'Gold Token',
                symbol: 'GLD',
                contractId: 'CA100',
                ownerPublicKey: 'GOWNER',
                decimals: 7,
            });

            const token2 = new Token({
                name: 'Silver Token',
                symbol: 'SLV',
                contractId: 'CA101',
                ownerPublicKey: 'GOWNER',
                decimals: 7,
            });

            await Promise.all([token1.save(), token2.save()]);

            cacheService.get.mockResolvedValueOnce(null);
            cacheService.set.mockResolvedValueOnce(undefined);

            // First query without search
            const response1 = await request(app)
                .get('/api/tokens/GOWNER')
                .query({ page: 1, limit: 20 });

            expect(response1.body.data).toHaveLength(2);

            // Second query with search
            cacheService.get.mockResolvedValueOnce(null);
            cacheService.set.mockResolvedValueOnce(undefined);

            const response2 = await request(app)
                .get('/api/tokens/GOWNER')
                .query({ page: 1, limit: 20, search: 'Gold' });

            expect(response2.body.data).toHaveLength(1);

            // Verify separate cache keys were used
            expect(cacheService.set).toHaveBeenNthCalledWith(
                1,
                'tokens:owner:GOWNER:page:1:limit:20:search:none',
                expect.any(Object)
            );

            expect(cacheService.set).toHaveBeenNthCalledWith(
                2,
                'tokens:owner:GOWNER:page:1:limit:20:search:Gold',
                expect.any(Object)
            );
        });
    });

    describe('POST /api/tokens - Cache Invalidation', () => {
        it('should invalidate cache when creating a new token', async () => {
            cacheService.deleteByPattern.mockResolvedValueOnce(3);

            const response = await request(app)
                .post('/api/tokens')
                .send({
                    name: 'New Token',
                    symbol: 'NEW',
                    decimals: 7,
                    contractId: 'CA_NEW_123',
                    ownerPublicKey: 'GOWNER_NEW',
                });

            expect(response.status).toBe(201);
            expect(response.body.name).toBe('New Token');

            // Verify cache invalidation
            expect(cacheService.deleteByPattern).toHaveBeenCalledWith('tokens:owner:GOWNER_NEW:*');
        });

        it('should handle cache invalidation failure gracefully', async () => {
            cacheService.deleteByPattern.mockRejectedValueOnce(new Error('Cache error'));

            const response = await request(app)
                .post('/api/tokens')
                .send({
                    name: 'Another Token',
                    symbol: 'ANTH',
                    decimals: 7,
                    contractId: 'CA_ANTH_456',
                    ownerPublicKey: 'GOWNER_ANTH',
                });

            expect(response.status).toBe(201);
            expect(response.body.name).toBe('Another Token');
            // Should still succeed despite cache error
        });

        it('should create audit record even if cache fails', async () => {
            cacheService.deleteByPattern.mockRejectedValueOnce(new Error('Cache error'));

            await request(app)
                .post('/api/tokens')
                .send({
                    name: 'Test Token',
                    symbol: 'TEST',
                    decimals: 7,
                    contractId: 'CA_TEST_789',
                    ownerPublicKey: 'GOWNER_TEST',
                });

            const audit = await DeploymentAudit.findOne({
                tokenName: 'Test Token',
            });

            expect(audit).toBeDefined();
            expect(audit.status).toBe('SUCCESS');
        });
    });

    describe('Cache Key Generation', () => {
        it('should generate correct cache keys for paginated queries', async () => {
            cacheService.get.mockResolvedValueOnce(null);
            cacheService.set.mockResolvedValueOnce(undefined);

            await request(app)
                .get('/api/tokens/GUSER')
                .query({ page: 2, limit: 50 });

            const setCalls = cacheService.set.mock.calls;
            expect(setCalls[0][0]).toBe('tokens:owner:GUSER:page:2:limit:50:search:none');
        });

        it('should generate correct cache keys with special characters in search', async () => {
            cacheService.get.mockResolvedValueOnce(null);
            cacheService.set.mockResolvedValueOnce(undefined);

            await request(app)
                .get('/api/tokens/GUSER')
                .query({ page: 1, limit: 20, search: 'Special Token' });

            const setCalls = cacheService.set.mock.calls;
            expect(setCalls[0][0]).toContain('search:Special Token');
        });
    });
});
