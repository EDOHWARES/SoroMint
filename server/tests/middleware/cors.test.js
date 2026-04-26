const cors = require("cors");

describe("CORS policy", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = {
      ...originalEnv,
      NODE_ENV: "test",
      MONGO_URI: "mongodb://localhost:27017/test-db",
      JWT_SECRET: "super-secret-test-key",
      JWT_EXPIRES_IN: "24h",
      SOROBAN_RPC_URL: "https://soroban-testnet.stellar.org",
      NETWORK_PASSPHRASE: "Test SDF Network ; September 2015",
    };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  function createMockResponse() {
    return {
      headers: {},
      statusCode: 200,
      ended: false,
      setHeader(name, value) {
        this.headers[name.toLowerCase()] = value;
      },
      getHeader(name) {
        return this.headers[name.toLowerCase()];
      },
      end() {
        this.ended = true;
      },
    };
  }

  function invokeMiddleware(middleware, reqOverrides = {}) {
    const req = {
      method: "GET",
      headers: {},
      ...reqOverrides,
    };
    const res = createMockResponse();
    let nextCalled = false;
    let nextError;

    middleware(req, res, (error) => {
      nextCalled = true;
      nextError = error;
    });

    return { req, res, nextCalled, nextError };
  }

  function loadCorsMiddleware() {
    const { createCorsOptionsDelegate } = require("../../config/cors-config");
    return cors(createCorsOptionsDelegate());
  }

  it("allows requests from configured origins", async () => {
    process.env.CORS_ALLOWED_ORIGINS = "https://app.example.com,http://localhost:5173";

    const middleware = loadCorsMiddleware();
    const { res, nextCalled, nextError } = invokeMiddleware(middleware, {
      headers: {
        origin: "https://app.example.com",
      },
    });

    expect(nextCalled).toBe(true);
    expect(nextError).toBeUndefined();
    expect(res.headers["access-control-allow-origin"]).toBe("https://app.example.com");
    expect(res.headers["access-control-expose-headers"]).toContain("X-Correlation-ID");
    expect(res.headers.vary).toContain("Origin");
  });

  it("blocks requests from unapproved origins", async () => {
    process.env.CORS_ALLOWED_ORIGINS = "https://app.example.com";

    const middleware = loadCorsMiddleware();
    const { res, nextCalled, nextError } = invokeMiddleware(middleware, {
      headers: {
        origin: "https://evil.example.com",
      },
    });

    expect(nextCalled).toBe(true);
    expect(nextError).toMatchObject({
      statusCode: 403,
      code: "CORS_ORIGIN_DENIED",
    });
    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("allows requests without an Origin header", async () => {
    process.env.CORS_ALLOWED_ORIGINS = "https://app.example.com";

    const middleware = loadCorsMiddleware();
    const { res, nextCalled, nextError } = invokeMiddleware(middleware);

    expect(nextCalled).toBe(true);
    expect(nextError).toBeUndefined();
    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("allows same-origin browser requests even when not listed in the CORS allowlist", async () => {
    process.env.CORS_ALLOWED_ORIGINS = "https://app.example.com";

    const middleware = loadCorsMiddleware();
    const { res, nextCalled, nextError } = invokeMiddleware(middleware, {
      headers: {
        origin: "https://api.soromint.dev",
        host: "api.soromint.dev",
      },
      protocol: "https",
    });

    expect(nextCalled).toBe(true);
    expect(nextError).toBeUndefined();
    expect(res.headers["access-control-allow-origin"]).toBe("https://api.soromint.dev");
  });

  it("handles preflight requests for configured origins", async () => {
    process.env.CORS_ALLOWED_ORIGINS = "https://app.example.com";

    const middleware = loadCorsMiddleware();
    const { res, nextCalled, nextError } = invokeMiddleware(middleware, {
      method: "OPTIONS",
      headers: {
        origin: "https://app.example.com",
        "access-control-request-method": "POST",
        "access-control-request-headers": "Authorization,Content-Type,X-Correlation-ID",
      },
    });

    expect(nextCalled).toBe(false);
    expect(nextError).toBeUndefined();
    expect(res.ended).toBe(true);
    expect(res.statusCode).toBe(204);
    expect(res.headers["access-control-allow-origin"]).toBe("https://app.example.com");
    expect(res.headers["access-control-allow-methods"]).toContain("POST");
    expect(res.headers["access-control-allow-headers"]).toContain("Authorization");
    expect(res.headers["access-control-max-age"]).toBe("600");
  });
});
