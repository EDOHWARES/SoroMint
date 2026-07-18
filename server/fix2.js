const fs = require('fs');
let content = fs.readFileSync('tests/utils/logger.test.js', 'utf8');

// The malformed block starts with:
//     const directEntry = buildStructuredLogEntry('error', 'Direct error', error);
// and ends with:
//     expect(nestedEntry.error.stack).toContain('boom');
//   });

const startMarker = "    const directEntry = buildStructuredLogEntry('error', 'Direct error', error);";
const endMarker = "    expect(nestedEntry.error.stack).toContain('boom');\r\n  });";
const endMarker2 = "    expect(nestedEntry.error.stack).toContain('boom');\n  });";

let startIndex = content.indexOf(startMarker);
if (startIndex === -1) {
    console.error("Start marker not found");
    process.exit(1);
}

let endIndex = content.indexOf(endMarker, startIndex);
let endMarkerLength = endMarker.length;
if (endIndex === -1) {
    endIndex = content.indexOf(endMarker2, startIndex);
    endMarkerLength = endMarker2.length;
}

if (endIndex === -1) {
    console.error("End marker not found");
    process.exit(1);
}

const beforeBlock = content.slice(0, startIndex);
const afterBlock = content.slice(endIndex + endMarkerLength);

const properBlock = `    const directEntry = buildStructuredLogEntry('error', 'Direct error', error);
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

// Replace it
content = beforeBlock + properBlock + afterBlock;

// Now for missing done block in OPTIONS test
const missingDoneMarkerStart = "      const mockLogger = { http: jest.fn() };\r\n      logger.http = mockLogger.http;";
const missingDoneMarkerStart2 = "      const mockLogger = { http: jest.fn() };\n      logger.http = mockLogger.http;";

let missingDoneIndex = content.indexOf(missingDoneMarkerStart);
let missingDoneMarkerLength = missingDoneMarkerStart.length;
if (missingDoneIndex === -1) {
    missingDoneIndex = content.indexOf(missingDoneMarkerStart2);
    missingDoneMarkerLength = missingDoneMarkerStart2.length;
}

if (missingDoneIndex !== -1) {
    const beforeDoneBlock = content.slice(0, missingDoneIndex);
    const properDoneBlock = `      const mockLogger = { http: jest.fn() };
      logger.http = mockLogger.http;

      const mockNext = jest.fn();
      httpLoggerMiddleware(mockReq, mockRes, mockNext);

      setTimeout(() => {
        expect(mockLogger.http).toHaveBeenCalled();
        done();
      }, 50);
    });`;

    // We also need to remove the "creates separate exact-level daily rotate transports" wait no, that's further down.
    // actually, let's just insert the proper done block.
    // wait, what does `beforeDoneBlock` have? It has the file up to `const mockLogger = ...`
    // Wait, let's look for the text right AFTER `logger.http = mockLogger.http;` which is `it('creates separate exact-level daily rotate transports'`
    
    let afterDoneIndex = content.indexOf("  it('creates separate exact-level daily rotate transports', () => {", missingDoneIndex);
    if (afterDoneIndex !== -1) {
        const afterDoneBlock = content.slice(afterDoneIndex);
        content = beforeDoneBlock + properDoneBlock + "\n\n" + afterDoneBlock;
    }
}

fs.writeFileSync('tests/utils/logger.test.js', content);
console.log("Fixed!");
