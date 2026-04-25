describe('HTTP logger sampling', () => {
  const originalEnv = process.env;

  const loadLoggerModule = () => {
    jest.resetModules();
    return require('../../utils/logger');
  };

  const createResponse = (statusCode) => {
    const listeners = {};
    return {
      statusCode,
      on: jest.fn((event, callback) => {
        listeners[event] = callback;
      }),
      finish: () => listeners.finish(),
    };
  };

  afterEach(() => {
    process.env = originalEnv;
    jest.restoreAllMocks();
  });

  it('skips unsampled successful requests when HTTP_LOG_SUCCESS_SAMPLE_RATE=0', () => {
    process.env = {
      ...originalEnv,
      NODE_ENV: 'test',
      HTTP_LOG_SUCCESS_SAMPLE_RATE: '0',
    };

    const { httpLoggerMiddleware, logger } = loadLoggerModule();
    logger.http = jest.fn();
    logger.warn = jest.fn();
    logger.error = jest.fn();
    const response = createResponse(200);
    const request = {
      method: 'GET',
      originalUrl: '/api/health',
      ip: '127.0.0.1',
      connection: { remoteAddress: '127.0.0.1' },
      get: jest.fn(() => 'agent'),
      correlationId: 'cid',
    };

    httpLoggerMiddleware(request, response, jest.fn());
    response.finish();

    expect(logger.http).not.toHaveBeenCalled();
    expect(logger.warn).not.toHaveBeenCalled();
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('always logs client and server errors even when 2xx logging is disabled', () => {
    process.env = {
      ...originalEnv,
      NODE_ENV: 'test',
      HTTP_LOG_SUCCESS_SAMPLE_RATE: '0',
    };

    const { httpLoggerMiddleware, logger } = loadLoggerModule();
    logger.http = jest.fn();
    logger.warn = jest.fn();
    logger.error = jest.fn();
    const warnResponse = createResponse(404);
    const errorResponse = createResponse(500);
    const request = {
      method: 'GET',
      originalUrl: '/api/health',
      ip: '127.0.0.1',
      connection: { remoteAddress: '127.0.0.1' },
      get: jest.fn(() => 'agent'),
      correlationId: 'cid',
    };

    httpLoggerMiddleware(request, warnResponse, jest.fn());
    warnResponse.finish();
    httpLoggerMiddleware(request, errorResponse, jest.fn());
    errorResponse.finish();

    expect(logger.warn).toHaveBeenCalledWith(
      'HTTP Request',
      expect.objectContaining({ statusCode: 404, ip: '127.0.0.1' })
    );
    expect(logger.error).toHaveBeenCalledWith(
      'HTTP Request',
      expect.objectContaining({ statusCode: 500, ip: '127.0.0.1' })
    );
  });

  it('can omit client metadata for sampled 2xx requests', () => {
    process.env = {
      ...originalEnv,
      NODE_ENV: 'test',
      HTTP_LOG_SUCCESS_SAMPLE_RATE: '1',
      HTTP_LOG_SUCCESS_INCLUDE_CLIENT_METADATA: 'false',
    };

    const { httpLoggerMiddleware, logger } = loadLoggerModule();
    logger.http = jest.fn();
    const response = createResponse(200);
    const request = {
      method: 'GET',
      originalUrl: '/api/health',
      ip: '127.0.0.1',
      connection: { remoteAddress: '127.0.0.1' },
      get: jest.fn(() => 'agent'),
      correlationId: 'cid',
    };

    httpLoggerMiddleware(request, response, jest.fn());
    response.finish();

    expect(logger.http).toHaveBeenCalledWith(
      'HTTP Request',
      expect.not.objectContaining({ ip: expect.anything(), userAgent: expect.anything() })
    );
  });
});
