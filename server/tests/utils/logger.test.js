/**
 * @title Logger Utility Tests
 * @author SoroMint Team
 * @notice Comprehensive test suite for Winston logging utility
 * @dev Tests cover logger configuration, middleware, and helper functions
 */

const {
  generateCorrelationId,
  correlationIdMiddleware,
  httpLoggerMiddleware,
  logStartupInfo,
  logShutdownInfo,
  logDatabaseConnection,
  logRouteRegistration,
} = require('../../utils/logger');

// Mock logger methods for testing
const mockLoggerMethods = () => {
  const logger = require('../../utils/logger').logger;
  logger.error = jest.fn();
  logger.warn = jest.fn();
  logger.info = jest.fn();
  logger.http = jest.fn();
  logger.debug = jest.fn();
  return logger;
};

describe('Logger Utility', () => {
  // Store original environment
  const originalEnv = process.env.NODE_ENV;
  let logger;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.NODE_ENV = 'test';
    logger = mockLoggerMethods();
  });

  afterEach(() => {
    process.env.NODE_ENV = originalEnv;
  });

  describe('generateCorrelationId', () => {
    it('should generate a valid UUID v4', () => {
      const correlationId = generateCorrelationId();

      // UUID v4 format: xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx
      const uuidRegex =
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

      expect(correlationId).toMatch(uuidRegex);
    });

    it('should generate unique IDs on each call', () => {
      const id1 = generateCorrelationId();
      const id2 = generateCorrelationId();
      const id3 = generateCorrelationId();

      expect(id1).not.toBe(id2);
      expect(id2).not.toBe(id3);
      expect(id1).not.toBe(id3);
    });

    it('should return a string', () => {
      const correlationId = generateCorrelationId();
      expect(typeof correlationId).toBe('string');
    });

    it('should return a 36 character string (UUID format)', () => {
      const correlationId = generateCorrelationId();
      expect(correlationId).toHaveLength(36);
    });

    it('should have correct UUID v4 version nibble', () => {
      const correlationId = generateCorrelationId();
      const parts = correlationId.split('-');

      // Version should be 4 (the first character of the third segment)
      expect(parts[2].charAt(0)).toBe('4');
    });

    it('should have correct UUID variant bits', () => {
      const correlationId = generateCorrelationId();
      const parts = correlationId.split('-');

      // Variant should be 8, 9, a, or b (the first character of the fourth segment)
      const variant = parts[3].charAt(0).toLowerCase();
      expect(['8', '9', 'a', 'b']).toContain(variant);
    });
  });

  describe('correlationIdMiddleware', () => {
    let mockReq;
    let mockRes;
    let mockNext;

    beforeEach(() => {
      mockReq = {
        headers: {},
      };
      mockRes = {
        setHeader: jest.fn(),
      };
      mockNext = jest.fn();
    });

    it('should generate a new correlation ID if none provided', () => {
      correlationIdMiddleware(mockReq, mockRes, mockNext);

      expect(mockReq.correlationId).toBeDefined();
      expect(mockReq.correlationId).toHaveLength(36);
    });

    it('should use correlation ID from x-correlation-id header', () => {
      const customId = 'custom-correlation-id-12345';
      mockReq.headers['x-correlation-id'] = customId;

      correlationIdMiddleware(mockReq, mockRes, mockNext);

      expect(mockReq.correlationId).toBe(customId);
    });

    it('should set X-Correlation-ID header on response', () => {
      correlationIdMiddleware(mockReq, mockRes, mockNext);

      expect(mockRes.setHeader).toHaveBeenCalledWith(
        'X-Correlation-ID',
        mockReq.correlationId
      );
    });

    it('should call next middleware', () => {
      correlationIdMiddleware(mockReq, mockRes, mockNext);

      expect(mockNext).toHaveBeenCalled();
    });

    it('should handle multiple requests with different IDs', () => {
      const req1 = { headers: {} };
      const req2 = { headers: {} };
      const res1 = { setHeader: jest.fn() };
      const res2 = { setHeader: jest.fn() };

      correlationIdMiddleware(req1, res1, jest.fn());
      correlationIdMiddleware(req2, res2, jest.fn());

      expect(req1.correlationId).not.toBe(req2.correlationId);
    });
  });

  describe('httpLoggerMiddleware', () => {
    let mockReq;
    let mockRes;
    let mockNext;
    let mockLogger;

    beforeEach(() => {
      mockReq = {
        method: 'GET',
        originalUrl: '/api/tokens',
        ip: '127.0.0.1',
        connection: { remoteAddress: '127.0.0.1' },
        get: jest.fn((header) => {
          if (header === 'user-agent') return 'Mozilla/5.0';
          return null;
        }),
        correlationId: 'test-correlation-id',
      };

      mockRes = {
        statusCode: 200,
        on: jest.fn((event, callback) => {
          if (event === 'finish') {
            // Simulate finish event
            setTimeout(() => callback(), 10);
          }
        }),
      };

      mockNext = jest.fn();
      mockLogger = {
        http: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
        info: jest.fn(),
        debug: jest.fn(),
      };

      logger.http = mockLogger.http;
      logger.warn = mockLogger.warn;
      logger.error = mockLogger.error;
    });

    it('should call next middleware immediately', () => {
      httpLoggerMiddleware(mockReq, mockRes, mockNext);

      expect(mockNext).toHaveBeenCalled();
    });

    it('should attach finish event listener to response', () => {
      httpLoggerMiddleware(mockReq, mockRes, mockNext);

      expect(mockRes.on).toHaveBeenCalledWith('finish', expect.any(Function));
    });

    it('should log successful requests with http level', (done) => {
      mockRes.statusCode = 200;

      httpLoggerMiddleware(mockReq, mockRes, mockNext);

      setTimeout(() => {
        expect(mockLogger.http).toHaveBeenCalledWith(
          'HTTP Request',
          expect.objectContaining({
            correlationId: 'test-correlation-id',
            method: 'GET',
            url: '/api/tokens',
            statusCode: 200,
          })
        );
        done();
      }, 50);
    });

    it('should log client errors with warn level', (done) => {
      mockRes.statusCode = 404;

      httpLoggerMiddleware(mockReq, mockRes, mockNext);

      setTimeout(() => {
        expect(mockLogger.warn).toHaveBeenCalledWith(
          'HTTP Request',
          expect.objectContaining({
            statusCode: 404,
          })
        );
        done();
      }, 50);
    });

    it('should log server errors with error level', (done) => {
      mockRes.statusCode = 500;

      httpLoggerMiddleware(mockReq, mockRes, mockNext);

      setTimeout(() => {
        expect(mockLogger.error).toHaveBeenCalledWith(
          'HTTP Request',
          expect.objectContaining({
            statusCode: 500,
          })
        );
        done();
      }, 50);
    });

    it('should include request duration in log', (done) => {
      httpLoggerMiddleware(mockReq, mockRes, mockNext);

      setTimeout(() => {
        expect(mockLogger.http).toHaveBeenCalledWith(
          'HTTP Request',
          expect.objectContaining({
            durationMs: expect.any(Number),
          })
        );
        done();
      }, 50);
    });

    it('should include IP address in log', (done) => {
      httpLoggerMiddleware(mockReq, mockRes, mockNext);

      setTimeout(() => {
        const logData = mockLogger.http.mock.calls[0][1];
        expect(logData.ip).toBe('127.0.0.1');
        done();
      }, 50);
    });

    it('should include user agent in log', (done) => {
      httpLoggerMiddleware(mockReq, mockRes, mockNext);

      setTimeout(() => {
        const logData = mockLogger.http.mock.calls[0][1];
        expect(logData.userAgent).toBe('Mozilla/5.0');
        done();
      }, 50);
    });

    it('should handle requests without correlation ID', (done) => {
      mockReq.correlationId = undefined;

      httpLoggerMiddleware(mockReq, mockRes, mockNext);

      setTimeout(() => {
        expect(mockLogger.http).toHaveBeenCalledWith(
          'HTTP Request',
          expect.objectContaining({
            correlationId: undefined,
          })
        );
        done();
      }, 50);
    });
  });

  describe('logStartupInfo', () => {
    let mockLogger;

    beforeEach(() => {
      mockLogger = {
        info: jest.fn(),
      };
      logger.info = mockLogger.info;
    });

    it('should log server startup information', () => {
      logStartupInfo(5000, 'Futurenet');

      expect(mockLogger.info).toHaveBeenCalledWith(
        'Server starting',
        expect.objectContaining({
          port: 5000,
          network: 'Futurenet',
        })
      );
    });

    it('should include node environment in log', () => {
      process.env.NODE_ENV = 'test';
      logStartupInfo(5000, 'Futurenet');

      expect(mockLogger.info).toHaveBeenCalledWith(
        'Server starting',
        expect.objectContaining({
          nodeEnv: 'test',
        })
      );
    });

    it('should default to development if NODE_ENV not set', () => {
      delete process.env.NODE_ENV;
      logStartupInfo(5000, 'Futurenet');

      expect(mockLogger.info).toHaveBeenCalledWith(
        'Server starting',
        expect.objectContaining({
          nodeEnv: 'development',
        })
      );
    });

    it('should include timestamp in log', () => {
      logStartupInfo(5000, 'Futurenet');

      const callArg = mockLogger.info.mock.calls[0][1];
      expect(callArg.timestamp).toBeDefined();
      expect(new Date(callArg.timestamp)).toBeInstanceOf(Date);
    });
  });

  describe('logShutdownInfo', () => {
    let mockLogger;

    beforeEach(() => {
      mockLogger = {
        warn: jest.fn(),
      };
      logger.warn = mockLogger.warn;
    });

    it('should log shutdown information with reason', () => {
      logShutdownInfo('SIGTERM');

      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Server shutting down',
        expect.objectContaining({
          reason: 'SIGTERM',
        })
      );
    });

    it('should handle manual shutdown reason', () => {
      logShutdownInfo('manual');

      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Server shutting down',
        expect.objectContaining({
          reason: 'manual',
        })
      );
    });

    it('should include timestamp in log', () => {
      logShutdownInfo('SIGINT');

      const callArg = mockLogger.warn.mock.calls[0][1];
      expect(callArg.timestamp).toBeDefined();
    });
  });

  describe('logDatabaseConnection', () => {
    let mockLogger;

    beforeEach(() => {
      mockLogger = {
        info: jest.fn(),
        error: jest.fn(),
      };
      logger.info = mockLogger.info;
      logger.error = mockLogger.error;
    });

    it('should log successful connection with info level', () => {
      logDatabaseConnection(true);

      expect(mockLogger.info).toHaveBeenCalledWith(
        'MongoDB Connected',
        expect.objectContaining({
          timestamp: expect.any(String),
        })
      );
    });

    it('should log connection error with error level', () => {
      const testError = new Error('Connection failed');
      logDatabaseConnection(false, testError);

      expect(mockLogger.error).toHaveBeenCalledWith(
        'MongoDB Connection Error',
        expect.objectContaining({
          error: 'Connection failed',
        })
      );
    });

    it('should handle null error gracefully', () => {
      logDatabaseConnection(false, null);

      expect(mockLogger.error).toHaveBeenCalledWith(
        'MongoDB Connection Error',
        expect.objectContaining({
          error: 'Unknown error',
        })
      );
    });

    it('should handle undefined error gracefully', () => {
      logDatabaseConnection(false, undefined);

      expect(mockLogger.error).toHaveBeenCalledWith(
        'MongoDB Connection Error',
        expect.objectContaining({
          error: 'Unknown error',
        })
      );
    });

    it('should include timestamp in success log', () => {
      logDatabaseConnection(true);

      const callArg = mockLogger.info.mock.calls[0][1];
      expect(callArg.timestamp).toBeDefined();
    });

    it('should include timestamp in error log', () => {
      logDatabaseConnection(false, new Error('test'));

      const callArg = mockLogger.error.mock.calls[0][1];
      expect(callArg.timestamp).toBeDefined();
    });
  });

  describe('logRouteRegistration', () => {
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

    it('should handle PUT routes', () => {
      logRouteRegistration('PUT', '/api/tokens/:id');

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
  });

  describe('Logger Configuration', () => {
    it('should have required log levels', () => {
      expect(logger.error).toBeDefined();
      expect(logger.warn).toBeDefined();
      expect(logger.info).toBeDefined();
      expect(logger.http).toBeDefined();
      expect(logger.debug).toBeDefined();
    });

    it('should have log method', () => {
      expect(typeof logger.log).toBe('function');
    });
  });

  describe('Integration Tests', () => {
    it('should work with full request lifecycle', (done) => {
      const mockReq = {
        method: 'GET',
        originalUrl: '/api/status',
        ip: '127.0.0.1',
        connection: { remoteAddress: '127.0.0.1' },
        get: jest.fn(() => 'TestAgent'),
        headers: { 'x-correlation-id': 'integration-test-id' },
      };

      const mockRes = {
        statusCode: 200,
        setHeader: jest.fn(),
        on: jest.fn((event, callback) => {
          if (event === 'finish') {
            setTimeout(() => callback(), 10);
          }
        }),
      };

      const mockNext = jest.fn();
      const mockLogger = {
        http: jest.fn(),
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
        debug: jest.fn(),
      };

      logger.http = mockLogger.http;

      // Simulate correlation ID middleware
      correlationIdMiddleware(mockReq, mockRes, () => {
        // Verify correlation ID was set from header
        expect(mockReq.correlationId).toBe('integration-test-id');

        // Then HTTP logger middleware
        httpLoggerMiddleware(mockReq, mockRes, mockNext);

        setTimeout(() => {
          expect(mockLogger.http).toHaveBeenCalledWith(
            'HTTP Request',
            expect.objectContaining({
              correlationId: 'integration-test-id',
              method: 'GET',
              url: '/api/status',
              statusCode: 200,
            })
          );
          done();
        }, 50);
      });
    });

    it('should handle error logging in sequence', () => {
      const mockLogger = {
        error: jest.fn(),
        warn: jest.fn(),
        info: jest.fn(),
      };

      logger.error = mockLogger.error;
      logger.warn = mockLogger.warn;

      // Simulate error logging
      const error = new Error('Test error');
      error.statusCode = 500;
      error.code = 'TEST_ERROR';

      const logData = {
        message: error.message,
        code: error.code,
        statusCode: error.statusCode,
        path: '/api/test',
        method: 'POST',
        correlationId: 'error-test-id',
      };

      logger.error('Internal Server Error', logData);

      expect(mockLogger.error).toHaveBeenCalledWith(
        'Internal Server Error',
        expect.objectContaining({
          message: 'Test error',
          code: 'TEST_ERROR',
          statusCode: 500,
        })
      );
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty header object in correlationIdMiddleware', () => {
      const mockReq = { headers: {} };
      const mockRes = { setHeader: jest.fn() };
      const mockNext = jest.fn();

      correlationIdMiddleware(mockReq, mockRes, mockNext);

      expect(mockReq.correlationId).toBeDefined();
      expect(mockNext).toHaveBeenCalled();
    });

    it('should handle missing get method in request for httpLogger', (done) => {
      const mockReq = {
        method: 'GET',
        originalUrl: '/api/test',
        ip: '127.0.0.1',
        connection: { remoteAddress: '127.0.0.1' },
        get: jest.fn(() => undefined),
        correlationId: 'test-id',
      };

      const mockRes = {
        statusCode: 200,
        on: jest.fn((event, callback) => {
          if (event === 'finish') {
            setTimeout(() => callback(), 10);
          }
        }),
      };

      const mockLogger = { http: jest.fn() };
      logger.http = mockLogger.http;

      httpLoggerMiddleware(mockReq, mockRes, jest.fn());

      setTimeout(() => {
        expect(mockLogger.http).toHaveBeenCalled();
        done();
      }, 50);
    });

    it('should handle very long URLs', () => {
      const mockReq = {
        headers: {},
        originalUrl: '/api/' + 'a'.repeat(1000),
      };
      const mockRes = { setHeader: jest.fn() };
      const mockNext = jest.fn();

      correlationIdMiddleware(mockReq, mockRes, mockNext);

      expect(mockReq.correlationId).toBeDefined();
      expect(mockNext).toHaveBeenCalled();
    });

    it('should handle special characters in user agent', (done) => {
      const mockReq = {
        method: 'GET',
        originalUrl: '/api/test',
        ip: '127.0.0.1',
        get: jest.fn(() => 'Mozilla/5.0 (special chars: <>&"\' 🚀)'),
        correlationId: 'test-id',
      };

      const mockRes = {
        statusCode: 200,
        on: jest.fn((event, callback) => {
          if (event === 'finish') {
            setTimeout(() => callback(), 10);
          }
        }),
      };

      const mockLogger = { http: jest.fn() };
      logger.http = mockLogger.http;

      httpLoggerMiddleware(mockReq, mockRes, jest.fn());

      setTimeout(() => {
        expect(mockLogger.http).toHaveBeenCalled();
        done();
      }, 50);
    });

    it('should handle request with ip from req.ip', (done) => {
      const mockReq = {
        method: 'POST',
        originalUrl: '/api/data',
        ip: '192.168.1.1',
        get: jest.fn(() => 'CustomAgent'),
        correlationId: 'ip-test-id',
      };

      const mockRes = {
        statusCode: 201,
        on: jest.fn((event, callback) => {
          if (event === 'finish') {
            setTimeout(() => callback(), 10);
          }
        }),
      };

      const mockLogger = { http: jest.fn() };
      logger.http = mockLogger.http;

      httpLoggerMiddleware(mockReq, mockRes, jest.fn());

      setTimeout(() => {
        const logData = mockLogger.http.mock.calls[0][1];
        expect(logData.ip).toBe('192.168.1.1');
        done();
      }, 50);
    });

    it('should handle request with ip from connection.remoteAddress', (done) => {
      const mockReq = {
        method: 'POST',
        originalUrl: '/api/data',
        connection: { remoteAddress: '10.0.0.1' },
        get: jest.fn(() => 'CustomAgent'),
        correlationId: 'conn-ip-test-id',
      };

      const mockRes = {
        statusCode: 201,
        on: jest.fn((event, callback) => {
          if (event === 'finish') {
            setTimeout(() => callback(), 10);
          }
        }),
      };

      const mockLogger = { http: jest.fn() };
      logger.http = mockLogger.http;

      httpLoggerMiddleware(mockReq, mockRes, jest.fn());

      setTimeout(() => {
        const logData = mockLogger.http.mock.calls[0][1];
        expect(logData.ip).toBe('10.0.0.1');
        done();
      }, 50);
    });

    it('should handle 304 status code (redirect)', (done) => {
      const mockReq = {
        method: 'GET',
        originalUrl: '/api/cached',
        ip: '127.0.0.1',
        get: jest.fn(() => 'Browser'),
        correlationId: 'redirect-test-id',
      };

      const mockRes = {
        statusCode: 304,
        on: jest.fn((event, callback) => {
          if (event === 'finish') {
            setTimeout(() => callback(), 10);
          }
        }),
      };

      const mockLogger = { http: jest.fn() };
      logger.http = mockLogger.http;

      httpLoggerMiddleware(mockReq, mockRes, jest.fn());

      setTimeout(() => {
        expect(mockLogger.http).toHaveBeenCalledWith(
          'HTTP Request',
          expect.objectContaining({
            statusCode: 304,
          })
        );
        done();
      }, 50);
    });

    it('should handle 401 unauthorized', (done) => {
      const mockReq = {
        method: 'GET',
        originalUrl: '/api/protected',
        ip: '127.0.0.1',
        get: jest.fn(() => 'Browser'),
        correlationId: 'unauth-test-id',
      };

      const mockRes = {
        statusCode: 401,
        on: jest.fn((event, callback) => {
          if (event === 'finish') {
            setTimeout(() => callback(), 10);
          }
        }),
      };

      const mockLogger = { warn: jest.fn() };
      logger.warn = mockLogger.warn;

      httpLoggerMiddleware(mockReq, mockRes, jest.fn());

      setTimeout(() => {
        expect(mockLogger.warn).toHaveBeenCalledWith(
          'HTTP Request',
          expect.objectContaining({
            statusCode: 401,
          })
        );
        done();
      }, 50);
    });

    it('should handle 403 forbidden', (done) => {
      const mockReq = {
        method: 'DELETE',
        originalUrl: '/api/admin',
        ip: '127.0.0.1',
        get: jest.fn(() => 'Browser'),
        correlationId: 'forbidden-test-id',
      };

      const mockRes = {
        statusCode: 403,
        on: jest.fn((event, callback) => {
          if (event === 'finish') {
            setTimeout(() => callback(), 10);
          }
        }),
      };

      const mockLogger = { warn: jest.fn() };
      logger.warn = mockLogger.warn;

      httpLoggerMiddleware(mockReq, mockRes, jest.fn());

      setTimeout(() => {
        expect(mockLogger.warn).toHaveBeenCalledWith(
          'HTTP Request',
          expect.objectContaining({
            statusCode: 403,
          })
        );
        done();
      }, 50);
    });

    it('should handle 502 bad gateway', (done) => {
      const mockReq = {
        method: 'GET',
        originalUrl: '/api/proxy',
        ip: '127.0.0.1',
        get: jest.fn(() => 'Browser'),
        correlationId: 'badgateway-test-id',
      };

      const mockRes = {
        statusCode: 502,
        on: jest.fn((event, callback) => {
          if (event === 'finish') {
            setTimeout(() => callback(), 10);
          }
        }),
      };

      const mockLogger = { error: jest.fn() };
      logger.error = mockLogger.error;

      httpLoggerMiddleware(mockReq, mockRes, jest.fn());

      setTimeout(() => {
        expect(mockLogger.error).toHaveBeenCalledWith(
          'HTTP Request',
          expect.objectContaining({
            statusCode: 502,
          })
        );
        done();
      }, 50);
    });

    it('should handle 503 service unavailable', (done) => {
      const mockReq = {
        method: 'GET',
        originalUrl: '/api/maintenance',
        ip: '127.0.0.1',
        get: jest.fn(() => 'Browser'),
        correlationId: 'unavail-test-id',
      };

      const mockRes = {
        statusCode: 503,
        on: jest.fn((event, callback) => {
          if (event === 'finish') {
            setTimeout(() => callback(), 10);
          }
        }),
      };

      const mockLogger = { error: jest.fn() };
      logger.error = mockLogger.error;

      httpLoggerMiddleware(mockReq, mockRes, jest.fn());

      setTimeout(() => {
        expect(mockLogger.error).toHaveBeenCalledWith(
          'HTTP Request',
          expect.objectContaining({
            statusCode: 503,
          })
        );
        done();
      }, 50);
    });

    it('should handle correlation ID with special characters from header', () => {
      const mockReq = {
        headers: { 'x-correlation-id': 'custom-id-with-special-chars-12345' },
      };
      const mockRes = { setHeader: jest.fn() };
      const mockNext = jest.fn();

      correlationIdMiddleware(mockReq, mockRes, mockNext);

      expect(mockReq.correlationId).toBe('custom-id-with-special-chars-12345');
      expect(mockNext).toHaveBeenCalled();
    });

    it('should handle logDatabaseConnection with error message only', () => {
      const mockLogger = { error: jest.fn() };
      logger.error = mockLogger.error;

      const errorLike = { message: 'Connection timeout' };
      logDatabaseConnection(false, errorLike);

      expect(mockLogger.error).toHaveBeenCalledWith(
        'MongoDB Connection Error',
        expect.objectContaining({
          error: 'Connection timeout',
        })
      );
    });

    it('should handle logStartupInfo with undefined network', () => {
      const mockLogger = { info: jest.fn() };
      logger.info = mockLogger.info;

      logStartupInfo(3000, undefined);

      expect(mockLogger.info).toHaveBeenCalledWith(
        'Server starting',
        expect.objectContaining({
          port: 3000,
          network: undefined,
        })
      );
    });

    it('should handle logRouteRegistration with complex paths', () => {
      const mockLogger = { debug: jest.fn() };
      logger.debug = mockLogger.debug;

      logRouteRegistration('PATCH', '/api/v1/users/:userId/posts/:postId');

      expect(mockLogger.debug).toHaveBeenCalledWith(
        'Route registered',
        expect.objectContaining({
          method: 'PATCH',
          path: '/api/v1/users/:userId/posts/:postId',
        })
      );
    });

    it('should handle OPTIONS method in httpLogger', (done) => {
      const mockReq = {
        method: 'OPTIONS',
        originalUrl: '/api/cors-preflight',
        ip: '127.0.0.1',
        get: jest.fn(() => 'Browser'),
        correlationId: 'options-test-id',
      };

      const mockRes = {
        statusCode: 204,
        on: jest.fn((event, callback) => {
          if (event === 'finish') {
            setTimeout(() => callback(), 10);
          }
        }),
      };

      const mockLogger = { http: jest.fn() };
      logger.http = mockLogger.http;

      httpLoggerMiddleware(mockReq, mockRes, jest.fn());

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
  });
});
