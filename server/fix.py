import sys

def main():
    with open('tests/utils/logger.test.js', 'r', encoding='utf-8') as f:
        lines = f.read().split('\n')
        # strip any trailing \r
        lines = [l.replace('\r', '') for l in lines]

    # Fix 1: Missing }); at line 68.
    # We look for:
    #       }),
    #     process.env.NODE_ENV = originalEnv;
    for i, line in enumerate(lines):
        if line == '    process.env.NODE_ENV = originalEnv;':
            if lines[i-1] == '      }),':
                lines.insert(i, '    });')
                break

    # Fix 2: Add logger to imports
    for i, line in enumerate(lines):
        if line == '  generateCorrelationId,':
            if lines[i-1] == 'const {':
                lines.insert(i, '  logger,')
                break

    # Fix 3: Fix malformed describe block
    start_idx = -1
    end_idx = -1
    for i, line in enumerate(lines):
        if line == "  describe('logRouteRegistration', () => {":
            if "error.code = 'E_BOOM';" in lines[i-1]:
                start_idx = i
                break
    
    if start_idx != -1:
        for i in range(start_idx, len(lines)):
            if lines[i] == "    expect(nestedEntry.error.stack).toContain('boom');":
                end_idx = i + 1
                break

    if start_idx != -1 and end_idx != -1:
        correct_block = """
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
  });""".strip('\n').split('\n')
        
        lines = lines[:start_idx] + correct_block + lines[end_idx:]

    # Fix 4: OPTIONS missing done block
    start_opts_idx = -1
    for i, line in enumerate(lines):
        if line == "  it('combines correlationIdMiddleware and httpLoggerMiddleware correctly', (done) => {":
            # Wait, the original file had this block cut.
            # It just had:
            #   });
            #         originalUrl: '/api/status',
            pass
            
    # Actually, in the original checked out file, around line 645 is the mangled httpLogger test.
    # Let's find:
    #     logger.http = originalHttp;
    #   });
    #         originalUrl: '/api/status',
    mangled_http_idx = -1
    for i, line in enumerate(lines):
        if line == "        originalUrl: '/api/status',":
            if lines[i-1] == "  });":
                mangled_http_idx = i
                break

    if mangled_http_idx != -1:
        # We replace the single line "        originalUrl: '/api/status'," 
        # with the correct start of the test:
        correct_http = """
  it('combines correlationIdMiddleware and httpLoggerMiddleware correctly', (done) => {
    const mockReq = {
      method: 'GET',
      originalUrl: '/api/status',""".strip('\n').split('\n')
        lines = lines[:mangled_http_idx] + correct_http + lines[mangled_http_idx+1:]


    # Fix 5: OPTIONS done callback missing at end of test block
    opts_done_idx = -1
    for i, line in enumerate(lines):
        if line == "      logger.http = mockLogger.http;":
            if "const mockLogger = { http: jest.fn() };" in lines[i-1]:
                opts_done_idx = i
                break

    if opts_done_idx != -1:
        # Replace up to `  it('creates separate exact-level daily rotate transports', () => {`
        next_it_idx = -1
        for j in range(opts_done_idx, len(lines)):
            if lines[j] == "  it('creates separate exact-level daily rotate transports', () => {":
                next_it_idx = j
                break
        
        if next_it_idx != -1:
            correct_opts_end = """
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
  });
""".strip('\n').split('\n')
            lines = lines[:opts_done_idx] + correct_opts_end + [""] + lines[next_it_idx:]

    with open('tests/utils/logger.test.js', 'w', encoding='utf-8') as f:
        f.write('\n'.join(lines))
    print("Done")

if __name__ == "__main__":
    main()
