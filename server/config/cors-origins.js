const DEFAULT_NON_PRODUCTION_CORS_ALLOWED_ORIGINS = Object.freeze([
  "http://localhost:3000",
  "http://127.0.0.1:3000",
  "http://localhost:4173",
  "http://127.0.0.1:4173",
  "http://localhost:5173",
  "http://127.0.0.1:5173",
]);

function getDefaultCorsAllowedOrigins(nodeEnv = process.env.NODE_ENV || "development") {
  if (nodeEnv === "production") {
    return "";
  }

  return DEFAULT_NON_PRODUCTION_CORS_ALLOWED_ORIGINS.join(",");
}

function normalizeOrigin(origin) {
  if (!origin || typeof origin !== "string") {
    throw new Error("CORS origin must be a non-empty string");
  }

  let parsedOrigin;

  try {
    parsedOrigin = new URL(origin);
  } catch (error) {
    throw new Error(`Invalid CORS origin: ${origin}`);
  }

  if (!["http:", "https:"].includes(parsedOrigin.protocol)) {
    throw new Error(`CORS origin must use http or https: ${origin}`);
  }

  if (
    parsedOrigin.username ||
    parsedOrigin.password ||
    parsedOrigin.pathname !== "/" ||
    parsedOrigin.search ||
    parsedOrigin.hash
  ) {
    throw new Error(
      `CORS origin must be a bare origin without path, query, hash, or credentials: ${origin}`,
    );
  }

  return parsedOrigin.origin;
}

function parseAllowedOrigins(rawOrigins) {
  if (Array.isArray(rawOrigins)) {
    return Array.from(new Set(rawOrigins.map(normalizeOrigin)));
  }

  if (typeof rawOrigins !== "string") {
    throw new Error("CORS_ALLOWED_ORIGINS must be a comma-separated string");
  }

  const normalizedOrigins = rawOrigins
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean)
    .map(normalizeOrigin);

  return Array.from(new Set(normalizedOrigins));
}

module.exports = {
  DEFAULT_NON_PRODUCTION_CORS_ALLOWED_ORIGINS,
  getDefaultCorsAllowedOrigins,
  normalizeOrigin,
  parseAllowedOrigins,
};
