/**
 * @title Status Routes Tests
 * @author SoroMint Team
 * @notice Test suite for system health check and network metadata routes
 */

const request = require('supertest');
const express = require('express');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const statusRoutes = require('../../routes/status-routes');
const { errorHandler } = require('../../middleware/error-handler');

let mongoServer;
let app;

beforeAll(async () => {
  // Setup in-memory MongoDB
  mongoServer = await MongoMemoryServer.create();
  const mongoUri = mongoServer.getUri();
  await mongoose.connect(mongoUri);

  // Set test environment variables
  process.env.NETWORK_PASSPHRASE = 'Test SDF Network ; September 2015';

  // Setup Express app
  app = express();
  app.use(express.json());
  app.use('/api', statusRoutes);
  app.use(errorHandler);
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
  delete process.env.NETWORK_PASSPHRASE;
});

describe('Status Routes', () => {
  describe('GET /api/health', () => {
    it('should return 200 and healthy status when database is connected', async () => {
      const response = await request(app).get('/api/health');

      expect(response.status).toBe(200);
      expect(response.body.status).toBe('healthy');
      expect(response.body.version).toBeDefined();
      expect(response.body.uptime).toBeDefined();
      expect(response.body.timestamp).toBeDefined();
      expect(response.body.services.database.status).toBe('up');
      expect(response.body.services.database.connection).toBe('connected');
      expect(response.body.services.stellar.network).toBe(
        'Test SDF Network ; September 2015'
      );
    });

    it('should include correct version from package.json', async () => {
      const { version } = require('../../package.json');
      const response = await request(app).get('/api/health');

      expect(response.body.version).toBe(version);
    });

    it('should handle missing NETWORK_PASSPHRASE environment variable', async () => {
      const originalPassphrase = process.env.NETWORK_PASSPHRASE;
      delete process.env.NETWORK_PASSPHRASE;

      const response = await request(app).get('/api/health');
      expect(response.body.services.stellar.network).toBe('not configured');

      process.env.NETWORK_PASSPHRASE = originalPassphrase;
    });

    it('should return 503 and unhealthy status when database is disconnected', async () => {
      // Force disconnect for this test
      await mongoose.disconnect();

      const response = await request(app).get('/api/health');

      expect(response.status).toBe(503);
      expect(response.body.status).toBe('unhealthy');
      expect(response.body.services.database.status).toBe('down');
      expect(response.body.services.database.connection).toBe('disconnected');

      // Reconnect for other tests (though this is the last one in this suite)
      const mongoUri = mongoServer.getUri();
      await mongoose.connect(mongoUri);
    });
  });
});
