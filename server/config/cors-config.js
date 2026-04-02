const { AppError } = require("../middleware/error-handler");
const { getEnv } = require("./env-config");
const { normalizeOrigin } = require("./cors-origins");

const CORS_ALLOWED_METHODS = Object.freeze([
  "GET",
  "HEAD",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "OPTIONS",
]);

const CORS_ALLOWED_HEADERS = Object.freeze([
  "Authorization",
  "Content-Type",
  "X-Correlation-ID",
]);

const CORS_EXPOSED_HEADERS = Object.freeze([
  "X-Correlation-ID",
]);

function getBaseCorsOptions() {
  return {
    methods: CORS_ALLOWED_METHODS,
    allowedHeaders: CORS_ALLOWED_HEADERS,
    exposedHeaders: CORS_EXPOSED_HEADERS,
    credentials: false,
    maxAge: 600,
    preflightContinue: false,
    optionsSuccessStatus: 204,
  };
}

function buildOriginValidator(allowedOrigins) {
  const allowedOriginSet = new Set(allowedOrigins);

  return (origin, callback) => {
    if (!origin) {
      // Allow same-origin and non-browser/server-to-server requests.
      return callback(null, true);
    }

    let normalizedOrigin;

    try {
      normalizedOrigin = normalizeOrigin(origin);
    } catch (error) {
      return callback(new AppError("Invalid Origin header", 400, "INVALID_ORIGIN_HEADER"));
    }

    if (allowedOriginSet.has(normalizedOrigin)) {
      return callback(null, true);
    }

    return callback(new AppError("Origin not allowed by CORS policy", 403, "CORS_ORIGIN_DENIED"));
  };
}

function isSameOriginRequest(req) {
  const requestOrigin = req.headers.origin;

  if (!requestOrigin) {
    return false;
  }

  const forwardedProto = req.headers["x-forwarded-proto"];
  const forwardedHost = req.headers["x-forwarded-host"];
  const requestProtocol = (Array.isArray(forwardedProto) ? forwardedProto[0] : forwardedProto)
    || req.protocol
    || "http";
  const requestHost = (Array.isArray(forwardedHost) ? forwardedHost[0] : forwardedHost)
    || req.headers.host;

  if (!requestHost) {
    return false;
  }

  try {
    return normalizeOrigin(requestOrigin) === normalizeOrigin(`${requestProtocol}://${requestHost}`);
  } catch (error) {
    return false;
  }
}

function getCorsOptions() {
  const env = getEnv();
  const baseCorsOptions = getBaseCorsOptions();

  return {
    ...baseCorsOptions,
    origin: buildOriginValidator(env.CORS_ALLOWED_ORIGINS),
  };
}

function createCorsOptionsDelegate() {
  const env = getEnv();
  const baseCorsOptions = getBaseCorsOptions();
  const originValidator = buildOriginValidator(env.CORS_ALLOWED_ORIGINS);

  return (req, callback) => {
    if (isSameOriginRequest(req)) {
      return callback(null, {
        ...baseCorsOptions,
        origin: true,
      });
    }

    return callback(null, {
      ...baseCorsOptions,
      origin: originValidator,
    });
  };
}

module.exports = {
  CORS_ALLOWED_METHODS,
  CORS_ALLOWED_HEADERS,
  CORS_EXPOSED_HEADERS,
  createCorsOptionsDelegate,
  buildOriginValidator,
  getCorsOptions,
  getBaseCorsOptions,
  isSameOriginRequest,
};
