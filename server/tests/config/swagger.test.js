/**
 * @title Swagger Configuration Tests
 * @author SoroMint Team
 * @notice Tests for Swagger/OpenAPI documentation setup and configuration
 */

const request = require('supertest');
const express = require('express');
const mongoose = require('mongoose');
const { setupSwagger, swaggerSpec, options } = require('../../config/swagger');

describe('Swagger Configuration', () => {
  let app;

  beforeAll(() => {
    // Setup Express app with Swagger
    app = express();
    app.use(express.json());
    setupSwagger(app);
  });

  describe('Swagger Spec Configuration', () => {
    it('should export valid swagger spec', () => {
      expect(swaggerSpec).toBeDefined();
      expect(typeof swaggerSpec).toBe('object');
    });

    it('should have correct OpenAPI version', () => {
      expect(swaggerSpec.openapi).toBe('3.0.0');
    });

    it('should have API info defined', () => {
      expect(swaggerSpec.info).toBeDefined();
      expect(swaggerSpec.info.title).toBe('SoroMint API');
      expect(swaggerSpec.info.version).toBe('1.0.0');
      expect(swaggerSpec.info.description).toBeDefined();
    });

    it('should have servers configured', () => {
      expect(swaggerSpec.servers).toBeDefined();
      expect(Array.isArray(swaggerSpec.servers)).toBe(true);
      expect(swaggerSpec.servers.length).toBeGreaterThan(0);

      const devServer = swaggerSpec.servers.find(
        (s) => s.description === 'Development server'
      );
      expect(devServer).toBeDefined();
      expect(devServer.url).toBe('http://localhost:5000');
    });

    it('should have tags defined', () => {
      expect(swaggerSpec.tags).toBeDefined();
      expect(Array.isArray(swaggerSpec.tags)).toBe(true);

      const tokenTag = swaggerSpec.tags.find((t) => t.name === 'Tokens');
      const systemTag = swaggerSpec.tags.find((t) => t.name === 'System');

      expect(tokenTag).toBeDefined();
      expect(systemTag).toBeDefined();
    });

    it('should have Token schema defined', () => {
      expect(swaggerSpec.components.schemas.Token).toBeDefined();
      expect(swaggerSpec.components.schemas.Token.type).toBe('object');
      expect(swaggerSpec.components.schemas.Token.required).toContain('name');
      expect(swaggerSpec.components.schemas.Token.required).toContain('symbol');
      expect(swaggerSpec.components.schemas.Token.required).toContain(
        'ownerPublicKey'
      );
    });

    it('should have TokenCreateInput schema defined', () => {
      expect(swaggerSpec.components.schemas.TokenCreateInput).toBeDefined();
      expect(swaggerSpec.components.schemas.TokenCreateInput.type).toBe(
        'object'
      );
    });

    it('should have Error schema defined', () => {
      expect(swaggerSpec.components.schemas.Error).toBeDefined();
      expect(swaggerSpec.components.schemas.Error.required).toContain('error');
      expect(swaggerSpec.components.schemas.Error.required).toContain('code');
    });

    it('should have Status schema defined', () => {
      expect(swaggerSpec.components.schemas.Status).toBeDefined();
    });

    it('should have correct schema properties for Token', () => {
      const tokenSchema = swaggerSpec.components.schemas.Token.properties;

      expect(tokenSchema.name).toBeDefined();
      expect(tokenSchema.name.type).toBe('string');

      expect(tokenSchema.symbol).toBeDefined();
      expect(tokenSchema.symbol.type).toBe('string');

      expect(tokenSchema.decimals).toBeDefined();
      expect(tokenSchema.decimals.type).toBe('integer');
      expect(tokenSchema.decimals.default).toBe(7);

      expect(tokenSchema.contractId).toBeDefined();
      expect(tokenSchema.contractId.type).toBe('string');

      expect(tokenSchema.ownerPublicKey).toBeDefined();
      expect(tokenSchema.ownerPublicKey.type).toBe('string');

      expect(tokenSchema.createdAt).toBeDefined();
      expect(tokenSchema.createdAt.type).toBe('string');
      expect(tokenSchema.createdAt.format).toBe('date-time');
    });
  });

  describe('Swagger Options', () => {
    it('should export options object', () => {
      expect(options).toBeDefined();
      expect(options.definition).toBeDefined();
      expect(options.apis).toBeDefined();
      expect(Array.isArray(options.apis)).toBe(true);
    });

    it('should have API file paths configured', () => {
      expect(options.apis.length).toBeGreaterThan(0);
      options.apis.forEach((apiPath) => {
        expect(typeof apiPath).toBe('string');
      });
    });
  });

  describe('Swagger UI Routes', () => {
    it('should serve Swagger UI at /api-docs', async () => {
      // swagger-ui-express redirects to /api-docs/ with trailing slash
      const response = await request(app).get('/api-docs/');

      expect(response.status).toBe(200);
      expect(response.headers['content-type']).toContain('text/html');
    });

    it('should redirect from /api-docs to /api-docs/', async () => {
      const response = await request(app).get('/api-docs');

      expect([200, 301, 302]).toContain(response.status);
    });

    it('should serve Swagger JSON at /api-docs.json', async () => {
      const response = await request(app).get('/api-docs.json');

      expect(response.status).toBe(200);
      expect(response.headers['content-type']).toContain('application/json');
      expect(response.body.openapi).toBe('3.0.0');
      expect(response.body.info.title).toBe('SoroMint API');
    });

    it('should include custom CSS in Swagger UI', async () => {
      const response = await request(app).get('/api-docs/');

      expect(response.text).toContain('.swagger-ui .topbar { display: none }');
    });

    it('should have custom site title', async () => {
      const response = await request(app).get('/api-docs/');

      expect(response.text).toContain('SoroMint API Docs');
    });
  });

  describe('API Documentation Content', () => {
    it('should document /api/status endpoint', () => {
      const paths = swaggerSpec.paths;

      expect(paths['/api/status']).toBeDefined();
      expect(paths['/api/status'].get).toBeDefined();

      const getOperation = paths['/api/status'].get;
      expect(getOperation.summary).toBeDefined();
      expect(getOperation.tags).toContain('System');
      expect(getOperation.responses['200']).toBeDefined();
    });

    it('should document /api/tokens/:owner endpoint', () => {
      const paths = swaggerSpec.paths;

      expect(paths['/api/tokens/{owner}']).toBeDefined();
      expect(paths['/api/tokens/{owner}'].get).toBeDefined();

      const getOperation = paths['/api/tokens/{owner}'].get;
      expect(getOperation.tags).toContain('Tokens');
      expect(getOperation.parameters).toBeDefined();

      const ownerParam = getOperation.parameters.find(
        (p) => p.name === 'owner'
      );
      expect(ownerParam).toBeDefined();
      expect(ownerParam.in).toBe('path');
      expect(ownerParam.required).toBe(true);
    });

    it('should document /api/tokens POST endpoint', () => {
      const paths = swaggerSpec.paths;

      expect(paths['/api/tokens']).toBeDefined();
      expect(paths['/api/tokens'].post).toBeDefined();

      const postOperation = paths['/api/tokens'].post;
      expect(postOperation.tags).toContain('Tokens');
      expect(postOperation.requestBody).toBeDefined();
      expect(postOperation.responses['201']).toBeDefined();
      expect(postOperation.responses['400']).toBeDefined();
    });

    it('should have operationId for all endpoints', () => {
      const paths = swaggerSpec.paths;

      expect(paths['/api/status'].get.operationId).toBe('getStatus');
      expect(paths['/api/tokens/{owner}'].get.operationId).toBe(
        'getTokensByOwner'
      );
      expect(paths['/api/tokens'].post.operationId).toBe('createToken');
    });
  });

  describe('Swagger Spec Integrity', () => {
    it('should have valid response codes defined', () => {
      const paths = swaggerSpec.paths;

      Object.values(paths).forEach((path) => {
        Object.values(path).forEach((operation) => {
          expect(operation.responses).toBeDefined();
          expect(typeof operation.responses).toBe('object');
        });
      });
    });

    it('should have descriptions for all schemas', () => {
      const schemas = swaggerSpec.components.schemas;

      Object.values(schemas).forEach((schema) => {
        expect(schema.description).toBeDefined();
      });
    });

    it('should have example values in schemas', () => {
      const tokenSchema = swaggerSpec.components.schemas.Token.properties;

      expect(tokenSchema.name.example).toBeDefined();
      expect(tokenSchema.symbol.example).toBeDefined();
      expect(tokenSchema.ownerPublicKey.example).toBeDefined();
    });
  });

  describe('Error Schema Validation', () => {
    it('should have all standard error codes defined', () => {
      const errorSchema = swaggerSpec.components.schemas.Error;
      const errorCodes = errorSchema.properties.code.enum;

      expect(errorCodes).toContain('VALIDATION_ERROR');
      expect(errorCodes).toContain('INVALID_ID');
      expect(errorCodes).toContain('DUPLICATE_KEY');
      expect(errorCodes).toContain('NOT_FOUND');
      expect(errorCodes).toContain('ROUTE_NOT_FOUND');
      expect(errorCodes).toContain('INTERNAL_ERROR');
    });

    it('should have error response examples', () => {
      const errorSchema = swaggerSpec.components.schemas.Error.properties;

      expect(errorSchema.error.example).toBeDefined();
      expect(errorSchema.code.example).toBeDefined();
    });
  });

  describe('Contact and License Info', () => {
    it('should have contact information', () => {
      expect(swaggerSpec.info.contact).toBeDefined();
      expect(swaggerSpec.info.contact.name).toBe('SoroMint Team');
    });

    it('should have license information', () => {
      expect(swaggerSpec.info.license).toBeDefined();
      expect(swaggerSpec.info.license.name).toBe('MIT');
    });
  });

  describe('Setup Function', () => {
    it('should return swagger spec when setup is called', () => {
      const testApp = express();
      const result = setupSwagger(testApp);

      expect(result).toBeDefined();
      expect(result).toEqual(swaggerSpec);
    });

    it('should attach middleware to app', () => {
      const testApp = express();
      setupSwagger(testApp);

      // Check that routes are registeredd by making a request
      return request(testApp)
        .get('/api-docs.json')
        .then((response) => {
          expect(response.status).toBe(200);
        });
    });
  });

  describe('Edge Cases', () => {
    it('should handle multiple setup calls gracefully', () => {
      const testApp1 = express();
      const testApp2 = express();

      const spec1 = setupSwagger(testApp1);
      const spec2 = setupSwagger(testApp2);

      expect(spec1).toEqual(spec2);
      expect(spec1).toBe(swaggerSpec);
    });

    it('should have consistent spec across multiple accesses', () => {
      const spec1 = swaggerSpec;
      const spec2 = swaggerSpec;

      expect(spec1).toBe(spec2); // Same reference
    });
  });
});
