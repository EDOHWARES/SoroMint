const fs = require('fs');

function fixFile() {
    let content = fs.readFileSync('tests/utils/logger.test.js', 'utf8');

    // 1. Fix missing });
    content = content.replace(
        /\s*\}\),\s*\}\),\s*process\.env\.NODE_ENV = originalEnv;/g,
        '\n        }),\n      }),\n    });\n    process.env.NODE_ENV = originalEnv;'
    );

    // 2. Add logger
    content = content.replace(
        /const \{\r?\n {2}generateCorrelationId,\r?\n {2}correlationIdMiddleware,/g,
        'const {\n  logger,\n  generateCorrelationId,\n  correlationIdMiddleware,'
    );

    // 3. Fix malformed block 548-581
    // We will find "  describe('logRouteRegistration', () => {" and extract the block to the bottom of the enclosing describe.
    
    // We'll replace the exact bad block with a placeholder using regex to avoid \r\n issues
    const badRegex = / {2}describe\('logRouteRegistration', \(\) => \{\r?\n {4}let mockLogger;\r?\n\r?\n {4}beforeEach\(\(\) => \{\r?\n {6}mockLogger = \{\r?\n {8}debug: jest\.fn\(\),\r?\n {6}\};\r?\n {6}logger\.debug = mockLogger\.debug;\r?\n {4}\}\);\r?\n\r?\n {4}it\('should log route registration with method and path', \(\) => \{\r?\n {6}logRouteRegistration\('GET', '\/api\/tokens'\);\r?\n\r?\n {6}expect\(mockLogger\.debug\)\.toHaveBeenCalledWith\(\r?\n {8}'Route registered',\r?\n {8}expect\.objectContaining\(\{\r?\n {10}method: 'GET',\r?\n {10}path: '\/api\/tokens',\r?\n {8}\}\)\r?\n {6}\);\r?\n {4}\}\);\r?\n\r?\n {4}it\('should handle POST routes', \(\) => \{\r?\n {6}logRouteRegistration\('POST', '\/api\/tokens'\);\r?\n\r?\n {6}expect\(mockLogger\.debug\)\.toHaveBeenCalledWith\(\r?\n {8}'Route registered',\r?\n {8}expect\.objectContaining\(\{\r?\n {10}method: 'POST',\r?\n {10}path: '\/api\/tokens',\r?\n {8}\}\)\r?\n {6}\);\r?\n {4}\}\);\r?\n\r?\n {4}const directEntry = buildStructuredLogEntry\('error', 'Direct error', error\);\r?\n {4}const nestedEntry = buildStructuredLogEntry\('error', 'Nested error', \{ error \}\);\r?\n\r?\n {4}expect\(directEntry\.error\)\.toMatchObject\(\{\r?\n {6}name: 'Error',\r?\n {6}message: 'boom',\r?\n {6}code: 'E_BOOM',\r?\n {4}\}\);\r?\n {4}expect\(directEntry\.error\.stack\)\.toContain\('boom'\);\r?\n {4}expect\(nestedEntry\.error\)\.toMatchObject\(\{\r?\n {6}name: 'Error',\r?\n {6}message: 'boom',\r?\n {6}code: 'E_BOOM',\r?\n {6}expect\(mockLogger\.debug\)\.toHaveBeenCalledWith\(\r?\n {8}'Route registered',\r?\n {8}expect\.objectContaining\(\{\r?\n {10}method: 'PUT',\r?\n {10}path: '\/api\/tokens\/:id',\r?\n {8}\}\)\r?\n {6}\);\r?\n {4}\}\);\r?\n\r?\n {4}it\('should handle DELETE routes', \(\) => \{\r?\n {6}logRouteRegistration\('DELETE', '\/api\/tokens\/:id'\);\r?\n\r?\n {6}expect\(mockLogger\.debug\)\.toHaveBeenCalledWith\(\r?\n {8}'Route registered',\r?\n {8}expect\.objectContaining\(\{\r?\n {10}method: 'DELETE',\r?\n {10}path: '\/api\/tokens\/:id',\r?\n {8}\}\)\r?\n {6}\);\r?\n {4}\}\);\r?\n {4}expect\(nestedEntry\.error\.stack\)\.toContain\('boom'\);\r?\n {2}\}\);/g;

    const correctBlockForOriginalLocation = `    const directEntry = buildStructuredLogEntry('error', 'Direct error', error);
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

    content = content.replace(badRegex, correctBlockForOriginalLocation);

    // 4. Fix httpLogger OPTIONS missing done
    const badHttpLoggerRegex = / {6}const mockLogger = \{ http: jest\.fn\(\) \};\r?\n {6}logger\.http = mockLogger\.http;\r?\n\r?\n {2}it\('creates separate exact-level/g;
    
    const correctHttpLogger = `      const mockLogger = { http: jest.fn() };
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

  it('creates separate exact-level`;

    content = content.replace(badHttpLoggerRegex, correctHttpLogger);

    fs.writeFileSync('tests/utils/logger.test.js', content);
    console.log("File fixed successfully!");
}

fixFile();
