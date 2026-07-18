const fs = require('fs');

let content = fs.readFileSync('tests/utils/logger.test.js', 'utf8');
content = content.replace(/\r\n/g, '\n');

// Fix 1: Missing }); at line 68
content = content.replace(
`        }),
      }),
    process.env.NODE_ENV = originalEnv;`,
`        }),
      }),
    });
    process.env.NODE_ENV = originalEnv;`
);

// Fix 2: Import logger
content = content.replace(
`const {
  generateCorrelationId,
  correlationIdMiddleware,`,
`const {
  logger,
  generateCorrelationId,
  correlationIdMiddleware,`
);

// Fix 3: Malformed describe block 513-581
const malformedBlock = `  describe('logRouteRegistration', () => {
    let mockLogger;

    beforeEach(() => {
      mockLogger = {
        debug: jest.fn(),
      };
      logger.debug = mockLogger.debug;
    });

    it('should log route registration with method and path', () => {
      logRouteRegistration('GET', '/api/tokens');

      expect(mockLogger.debug).toHaveBeenCalledWith(
        'Route registered',
        expect.objectContaining({
          method: 'GET',
          path: '/api/tokens',
        })
      );
    });

    it('should handle POST routes', () => {
      logRouteRegistration('POST', '/api/tokens');

      expect(mockLogger.debug).toHaveBeenCalledWith(
        'Route registered',
        expect.objectContaining({
          method: 'POST',
          path: '/api/tokens',
        })
      );
    });

    const directEntry = buildStructuredLogEntry('error', 'Direct error', error);
    const nestedEntry = buildStructuredLogEntry('error', 'Nested error', { error });

    expect(directEntry.error).toMatchObject({
      name: 'Error',
      message: 'boom',
      code: 'E_BOOM',
    });
    expect(directEntry.error.stack).toContain('boom');
    expect(nestedEntry.error).toMatchObject({
      name: 'Error',
      message: 'boom',
      code: 'E_BOOM',
      expect(mockLogger.debug).toHaveBeenCalledWith(
        'Route registered',
        expect.objectContaining({
          method: 'PUT',
          path: '/api/tokens/:id',
        })
      );
    });

    it('should handle DELETE routes', () => {
      logRouteRegistration('DELETE', '/api/tokens/:id');

      expect(mockLogger.debug).toHaveBeenCalledWith(
        'Route registered',
        expect.objectContaining({
          method: 'DELETE',
          path: '/api/tokens/:id',
        })
      );
    });
    expect(nestedEntry.error.stack).toContain('boom');
  });`;

const correctBlock = `    const directEntry = buildStructuredLogEntry('error', 'Direct error', error);
    const nestedEntry = buildStructuredLogEntry('error', 'Nested error', { error });

    expect(directEntry.error).toMatchObject({
      name: 'Error',
      message: 'boom',
      code: 'E_BOOM',
    });
    expect(directEntry.error.stack).toContain('boom');
    expect(nestedEntry.error).toMatchObject({
      name: 'Error',
      message: 'boom',
      code: 'E_BOOM',
    });
    expect(nestedEntry.error.stack).toContain('boom');
  });

  describe('logRouteRegistration', () => {
    let mockLogger;
    let localLogRouteRegistration;

    beforeEach(() => {
      mockLogger = {
        debug: jest.fn(),
      };
      const module = loadLoggerModule();
      module.logger.debug = mockLogger.debug;
      localLogRouteRegistration = module.logRouteRegistration;
    });

    it('should log route registration with method and path', () => {
      localLogRouteRegistration('GET', '/api/tokens');

      expect(mockLogger.debug).toHaveBeenCalledWith(
        'Route registered',
        expect.objectContaining({
          method: 'GET',
          path: '/api/tokens',
        })
      );
    });

    it('should handle POST routes', () => {
      localLogRouteRegistration('POST', '/api/tokens');

      expect(mockLogger.debug).toHaveBeenCalledWith(
        'Route registered',
        expect.objectContaining({
          method: 'POST',
          path: '/api/tokens',
        })
      );
    });

    it('should handle PUT routes with parameters', () => {
      localLogRouteRegistration('PUT', '/api/tokens/:id');

      expect(mockLogger.debug).toHaveBeenCalledWith(
        'Route registered',
        expect.objectContaining({
          method: 'PUT',
          path: '/api/tokens/:id',
        })
      );
    });

    it('should handle DELETE routes', () => {
      localLogRouteRegistration('DELETE', '/api/tokens/:id');

      expect(mockLogger.debug).toHaveBeenCalledWith(
        'Route registered',
        expect.objectContaining({
          method: 'DELETE',
          path: '/api/tokens/:id',
        })
      );
    });
  });`;

content = content.replace(malformedBlock, correctBlock);

// Fix 4: Mangled httpLogger test around line 645
const mangledHttpBlock = `  });
        originalUrl: '/api/status',
        ip: '127.0.0.1',
        connection: { remoteAddress: '127.0.0.1' },
        get: jest.fn(() => 'TestAgent'),
        headers: { 'x-correlation-id': 'integration-test-id' },
      };`;

const correctHttpBlock = `  });

  it('combines correlationIdMiddleware and httpLoggerMiddleware correctly', (done) => {
    const mockReq = {
      method: 'GET',
      originalUrl: '/api/status',
      ip: '127.0.0.1',
      connection: { remoteAddress: '127.0.0.1' },
      get: jest.fn(() => 'TestAgent'),
      headers: { 'x-correlation-id': 'integration-test-id' },
    };`;

content = content.replace(mangledHttpBlock, correctHttpBlock);

// Fix 5: OPTIONS done callback missing at end of file
const mangledOptionsBlock = `      const mockLogger = { http: jest.fn() };
      logger.http = mockLogger.http;

  it('creates separate exact-level daily rotate transports', () => {`;

const correctOptionsBlock = `      const mockLogger = { http: jest.fn() };
      const { logger: localLogger, httpLoggerMiddleware: localHttpLoggerMiddleware } = loadLoggerModule();
      localLogger.http = mockLogger.http;

      const mockNext = jest.fn();
      localHttpLoggerMiddleware(mockReq, mockRes, mockNext);

      setTimeout(() => {
        expect(mockLogger.http).toHaveBeenCalledWith(
          'HTTP Request',
          expect.objectContaining({
            method: 'OPTIONS',
            statusCode: 204,
          })
        );
        done();
      }, 50);
    });

  it('creates separate exact-level daily rotate transports', () => {`;

content = content.replace(mangledOptionsBlock, correctOptionsBlock);

fs.writeFileSync('tests/utils/logger.test.js', content);
console.log('Fixed');
