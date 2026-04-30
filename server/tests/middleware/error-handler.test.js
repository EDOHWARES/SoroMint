/**
 * @title Error Handler Middleware Tests
 * @author SoroMint Team
 * @notice Comprehensive test suite for centralized error handling middleware
 * @dev Tests cover AppError class, errorHandler, notFoundHandler, and asyncHandler
 */

const request = require('supertest');
const express = require('express');
const {
  errorHandler,
  notFoundHandler,
  asyncHandler,
  AppError,
} = require('../../middleware/error-handler');
const { logger, buildStructuredLogEntry, correlationIdMiddleware } = require('../../utils/logger');

describe('Error Handler Middleware', () => {
  let app;

  beforeEach(() => {
    app = express();
    app.use(express.json());
  });

  describe('AppError Class', () => {
    it('should create an AppError with default values', () => {
      const error = new AppError('Test error');

      expect(error.message).toBe('Test error');
      expect(error.statusCode).toBe(500);
      expect(error.code).toBe('INTERNAL_ERROR');
      expect(error.isOperational).toBe(true);
    });

    it('should create an AppError with custom values', () => {
      const error = new AppError('Custom error', 404, 'CUSTOM_CODE');

      expect(error.message).toBe('Custom error');
      expect(error.statusCode).toBe(404);
      expect(error.code).toBe('CUSTOM_CODE');
      expect(error.isOperational).toBe(true);
    });

    it('should capture stack trace', () => {
      const error = new AppError('Stack trace error');

      expect(error.stack).toBeDefined();
      expect(error.stack).toContain('Stack trace error');
    });

    it('should have Error in prototype chain', () => {
      const error = new AppError('Test');

      expect(error).toBeInstanceOf(Error);
      expect(error).toBeInstanceOf(AppError);
    });
  });

  describe('errorHandler Middleware', () => {
    it('should handle AppError with custom status code', async () => {
      process.env.NODE_ENV = 'production';

      app.get('/test', (req, res, next) => {
        const error = new AppError('Resource not found', 404, 'NOT_FOUND');
        next(error);
      });
      app.use(errorHandler);

      const response = await request(app).get('/test');

      expect(response.status).toBe(404);
      expect(response.body).toEqual({
        error: 'Resource not found',
        code: 'NOT_FOUND',
        status: 404,
      });

      delete process.env.NODE_ENV;
    });

    it('should handle generic Error with 500 status', async () => {
      app.get('/test', (req, res, next) => {
        const error = new Error('Generic error');
        next(error);
      });
      app.use(errorHandler);

      const response = await request(app).get('/test');

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('An unexpected error occurred');
      expect(response.body.code).toBe('INTERNAL_ERROR');
    });

    it('should include stack trace in development mode', async () => {
      process.env.NODE_ENV = 'development';

      app.get('/test', (req, res, next) => {
        const error = new AppError('Dev error', 400, 'DEV_ERROR');
        next(error);
      });
      app.use(errorHandler);

      const response = await request(app).get('/test');

      expect(response.body.stack).toBeDefined();
      expect(response.body.stack).toContain('Dev error');

      // Reset to default
      delete process.env.NODE_ENV;
    });

    it('should NOT include stack trace in production mode', async () => {
      process.env.NODE_ENV = 'production';

      app.get('/test', (req, res, next) => {
        const error = new AppError('Prod error', 400, 'PROD_ERROR');
        next(error);
      });
      app.use(errorHandler);

      const response = await request(app).get('/test');

      expect(response.body.stack).toBeUndefined();

      // Reset to default
      delete process.env.NODE_ENV;
    });

    it('should handle Mongoose ValidationError', async () => {
      const mongoose = require('mongoose');

      app.get('/test', (req, res, next) => {
        const validationError = new mongoose.Error.ValidationError();
        validationError.name = 'ValidationError';
        validationError.errors = {
          name: { message: 'Name is required' },
          email: { message: 'Invalid email format' },
        };
        next(validationError);
      });
      app.use(errorHandler);

      const response = await request(app).get('/test');

      expect(response.status).toBe(400);
      expect(response.body.code).toBe('VALIDATION_ERROR');
      expect(response.body.error).toContain('Name is required');
    });

    it('should handle Mongoose CastError (invalid ObjectId)', async () => {
      app.get('/test', (req, res, next) => {
        const castError = new Error('Cast to ObjectId failed');
        castError.name = 'CastError';
        castError.path = '_id';
        castError.value = 'invalid-id';
        next(castError);
      });
      app.use(errorHandler);

      const response = await request(app).get('/test');

      expect(response.status).toBe(400);
      expect(response.body.code).toBe('INVALID_ID');
      expect(response.body.error).toContain('Invalid _id');
    });

    it('should handle duplicate key error (code 11000)', async () => {
      app.get('/test', (req, res, next) => {
        const dupError = new Error('Duplicate key');
        dupError.code = 11000;
        dupError.keyPattern = { email: 1 };
        next(dupError);
      });
      app.use(errorHandler);

      const response = await request(app).get('/test');

      expect(response.status).toBe(409);
      expect(response.body.code).toBe('DUPLICATE_KEY');
      expect(response.body.error).toBe('email already exists');
    });

    it('should handle NotFoundError', async () => {
      app.get('/test', (req, res, next) => {
        const notFoundError = new Error('Resource not found');
        notFoundError.name = 'NotFoundError';
        next(notFoundError);
      });
      app.use(errorHandler);

      const response = await request(app).get('/test');

      expect(response.status).toBe(404);
      expect(response.body.code).toBe('NOT_FOUND');
    });

    it('should handle JsonWebTokenError', async () => {
      app.get('/test', (req, res, next) => {
        const jwtError = new Error('Invalid token');
        jwtError.name = 'JsonWebTokenError';
        next(jwtError);
      });
      app.use(errorHandler);

      const response = await request(app).get('/test');

      expect(response.status).toBe(401);
      expect(response.body.code).toBe('INVALID_TOKEN');
    });

    it('should handle TokenExpiredError', async () => {
      app.get('/test', (req, res, next) => {
        const expiredError = new Error('Token expired');
        expiredError.name = 'TokenExpiredError';
        next(expiredError);
      });
      app.use(errorHandler);

      const response = await request(app).get('/test');

      expect(response.status).toBe(401);
      expect(response.body.code).toBe('TOKEN_EXPIRED');
    });

    it('should handle SyntaxError', async () => {
      app.get('/test', (req, res, next) => {
        const syntaxError = new SyntaxError('Unexpected token');
        next(syntaxError);
      });
      app.use(errorHandler);

      const response = await request(app).get('/test');

      expect(response.status).toBe(400);
      expect(response.body.code).toBe('SYNTAX_ERROR');
    });

    it('should handle non-operational errors safely', async () => {
      app.get('/test', (req, res, next) => {
        const programmingError = new Error('Programming bug');
        // No statusCode means non-operational
        next(programmingError);
      });
      app.use(errorHandler);

      const response = await request(app).get('/test');

      expect(response.status).toBe(500);
      expect(response.body.code).toBe('INTERNAL_ERROR');
      expect(response.body.error).toBe('An unexpected error occurred');
    });

    it('should log error details via Winston logger', async () => {
      app.get('/test', (req, res, next) => {
        const error = new AppError('Log test', 400, 'LOG_TEST');
        next(error);
      });
      app.use(errorHandler);

      const response = await request(app).get('/test');

      expect(response.status).toBe(400);
      expect(response.body.code).toBe('LOG_TEST');
      // Winston logs are tested indirectly through the logger module tests
      // This test verifies the error handler still processes errors correctly
    });

    it('should emit structured warn logs with request metadata and stack traces', async () => {
      const originalWarn = logger.warn;
      logger.warn = jest.fn();

      app.use(correlationIdMiddleware);
      app.get('/test', (req, res, next) => {
        next(new AppError('Warn log test', 422, 'WARN_TEST'));
      });
      app.use(errorHandler);

      const response = await request(app)
        .get('/test')
        .set('X-Correlation-ID', 'warn-request-id');

      expect(response.status).toBe(422);
      expect(logger.warn).toHaveBeenCalledWith(
        'Client Error',
        expect.objectContaining({
          requestId: 'warn-request-id',
          correlationId: 'warn-request-id',
          path: '/test',
          method: 'GET',
          statusCode: 422,
          code: 'WARN_TEST',
          isOperational: true,
          error: expect.any(AppError),
        })
      );

      const [message, metadata] = logger.warn.mock.calls[0];
      const entry = buildStructuredLogEntry('warn', message, metadata);
      expect(entry.requestId).toBe('warn-request-id');
      expect(entry.metadata).toEqual(
        expect.objectContaining({
          path: '/test',
          method: 'GET',
          statusCode: 422,
          code: 'WARN_TEST',
          isOperational: true,
        })
      );
      expect(entry.error.stack).toContain('Warn log test');

      logger.warn = originalWarn;
    });

    it('should emit structured error logs without leaking production stacks to clients', async () => {
      process.env.NODE_ENV = 'production';
      const originalError = logger.error;
      logger.error = jest.fn();

      app.use(correlationIdMiddleware);
      app.get('/test', (req, res, next) => {
        next(new Error('Database exploded'));
      });
      app.use(errorHandler);

      const response = await request(app)
        .get('/test')
        .set('X-Correlation-ID', 'error-request-id');

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('An unexpected error occurred');
      expect(response.body.stack).toBeUndefined();
      expect(logger.error).toHaveBeenCalledWith(
        'Internal Server Error',
        expect.objectContaining({
          requestId: 'error-request-id',
          correlationId: 'error-request-id',
          path: '/test',
          method: 'GET',
          statusCode: 500,
          code: 'INTERNAL_ERROR',
          isOperational: false,
          error: expect.any(Error),
        })
      );

      const [message, metadata] = logger.error.mock.calls[0];
      const entry = buildStructuredLogEntry('error', message, metadata);
      expect(entry.requestId).toBe('error-request-id');
      expect(entry.error.message).toBe('Database exploded');
      expect(entry.error.stack).toContain('Database exploded');

      logger.error = originalError;
      delete process.env.NODE_ENV;
    });
  });

  describe('notFoundHandler Middleware', () => {
    it('should return 404 for undefined routes', async () => {
      app.use(notFoundHandler);
      app.use(errorHandler);

      const response = await request(app).get('/nonexistent-route');

      expect(response.status).toBe(404);
      expect(response.body.code).toBe('ROUTE_NOT_FOUND');
      expect(response.body.error).toContain('/nonexistent-route');
    });

    it('should include the full originalUrl in error message', async () => {
      app.use(notFoundHandler);
      app.use(errorHandler);

      const response = await request(app).get('/api/v1/users/123/posts');

      expect(response.body.error).toContain('/api/v1/users/123/posts');
    });

    it('should work with POST requests', async () => {
      app.use(notFoundHandler);
      app.use(errorHandler);

      const response = await request(app).post('/nonexistent-post');

      expect(response.status).toBe(404);
      expect(response.body.code).toBe('ROUTE_NOT_FOUND');
    });
  });

  describe('asyncHandler Wrapper', () => {
    it('should catch and forward async errors', async () => {
      app.get(
        '/test',
        asyncHandler(async (req, res) => {
          throw new AppError('Async error', 400, 'ASYNC_ERROR');
        })
      );
      app.use(errorHandler);

      const response = await request(app).get('/test');

      expect(response.status).toBe(400);
      expect(response.body.code).toBe('ASYNC_ERROR');
    });

    it('should handle successful async operations', async () => {
      app.get(
        '/test',
        asyncHandler(async (req, res) => {
          res.json({ success: true, data: 'test data' });
        })
      );

      const response = await request(app).get('/test');

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ success: true, data: 'test data' });
    });

    it('should handle Promise rejections', async () => {
      app.get(
        '/test',
        asyncHandler(async (req, res) => {
          await Promise.reject(
            new AppError('Promise rejection', 503, 'SERVICE_UNAVAILABLE')
          );
        })
      );
      app.use(errorHandler);

      const response = await request(app).get('/test');

      expect(response.status).toBe(503);
      expect(response.body.code).toBe('SERVICE_UNAVAILABLE');
    });

    it('should work with middleware that uses next()', async () => {
      app.get(
        '/test',
        asyncHandler(async (req, res, next) => {
          req.testValue = 'injected';
          await Promise.resolve();
          res.json({ value: req.testValue });
        })
      );

      const response = await request(app).get('/test');

      expect(response.status).toBe(200);
      expect(response.body.value).toBe('injected');
    });
  });

  describe('formatErrorResponse (internal function)', () => {
    it('should format error with all fields', () => {
      // This tests the internal logic through the middleware
      const error = new AppError('Format test', 403, 'FORMAT_TEST');

      // We verify through the middleware output
      const testApp = express();
      testApp.get('/test', (req, res, next) => {
        next(error);
      });
      testApp.use(errorHandler);

      return request(testApp)
        .get('/test')
        .then((response) => {
          expect(response.body).toHaveProperty('error');
          expect(response.body).toHaveProperty('code');
          expect(response.body).toHaveProperty('status');
        });
    });
  });

  describe('Integration Tests', () => {
    it('should handle errors in sequence of middleware', async () => {
      app.use((req, res, next) => {
        req.startTime = Date.now();
        next();
      });

      app.get(
        '/test',
        asyncHandler(async (req, res) => {
          throw new AppError('Integration test error', 422, 'INTEGRATION_TEST');
        })
      );

      app.use(notFoundHandler);
      app.use(errorHandler);

      const response = await request(app).get('/test');

      expect(response.status).toBe(422);
      expect(response.body.code).toBe('INTEGRATION_TEST');
    });

    it('should handle errors after JSON parsing', async () => {
      app.post(
        '/test',
        asyncHandler(async (req, res) => {
          // req.body is already parsed by express.json()
          if (!req.body.name) {
            throw new AppError('Name is required', 400, 'VALIDATION_ERROR');
          }
          res.json({ name: req.body.name });
        })
      );
      app.use(errorHandler);

      const response = await request(app).post('/test').send({ name: 'Test' });

      expect(response.status).toBe(200);
      expect(response.body.name).toBe('Test');
    });

    it('should handle multiple sequential errors correctly', async () => {
      const testApp = express();
      testApp.use(express.json());

      testApp.get('/error1', (req, res, next) => {
        next(new AppError('First error', 400, 'FIRST_ERROR'));
      });

      testApp.get('/error2', (req, res, next) => {
        next(new AppError('Second error', 401, 'SECOND_ERROR'));
      });

      testApp.use(errorHandler);

      const response1 = await request(testApp).get('/error1');
      const response2 = await request(testApp).get('/error2');

      expect(response1.status).toBe(400);
      expect(response1.body.code).toBe('FIRST_ERROR');
      expect(response2.status).toBe(401);
      expect(response2.body.code).toBe('SECOND_ERROR');
    });
  });

  describe('Edge Cases', () => {
    it('should handle error with no message', async () => {
      app.get('/test', (req, res, next) => {
        const error = new Error();
        next(error);
      });
      app.use(errorHandler);

      const response = await request(app).get('/test');

      expect(response.body.error).toBe('An unexpected error occurred');
    });

    it('should handle error with null message', async () => {
      app.get('/test', (req, res, next) => {
        const error = new AppError(null, 400, 'NULL_ERROR');
        next(error);
      });
      app.use(errorHandler);

      const response = await request(app).get('/test');

      expect(response.body.error).toBe('An unexpected error occurred');
    });

    it('should handle error with empty string message', async () => {
      app.get('/test', (req, res, next) => {
        const error = new AppError('', 400, 'EMPTY_ERROR');
        next(error);
      });
      app.use(errorHandler);

      const response = await request(app).get('/test');

      expect(response.body.error).toBe('An unexpected error occurred');
    });

    it('should handle very long error messages', async () => {
      const longMessage = 'A'.repeat(1000);

      app.get('/test', (req, res, next) => {
        const error = new AppError(longMessage, 400, 'LONG_ERROR');
        next(error);
      });
      app.use(errorHandler);

      const response = await request(app).get('/test');

      expect(response.body.error).toBe(longMessage);
      expect(response.status).toBe(400);
    });

    it('should handle error with special characters in message', async () => {
      const specialMessage = 'Error with special chars: <>&"\' and emoji 🚀';

      app.get('/test', (req, res, next) => {
        const error = new AppError(specialMessage, 400, 'SPECIAL_ERROR');
        next(error);
      });
      app.use(errorHandler);

      const response = await request(app).get('/test');

      expect(response.body.error).toBe(specialMessage);
    });
  });
});
