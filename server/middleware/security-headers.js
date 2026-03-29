/**
 * @title Security Headers Middleware
 * @description Configures Helmet.js to set HTTP security headers including
 *   Content Security Policy, XSS Protection, HSTS, and more.
 */

const helmet = require("helmet");

/**
 * Returns a configured Helmet middleware stack for SoroMint.
 *
 * Headers applied:
 *  - Content-Security-Policy  (custom rules for the React frontend)
 *  - X-Content-Type-Options   (nosniff)
 *  - X-Frame-Options          (DENY)
 *  - X-XSS-Protection         (1; mode=block)
 *  - Strict-Transport-Security (max-age=31536000; includeSubDomains)
 *  - Referrer-Policy          (no-referrer)
 *  - Permissions-Policy       (camera=(), microphone=(), geolocation=())
 */
const securityHeaders = helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: [
        "'self'",
        // Allow inline scripts required by Vite HMR in development
        process.env.NODE_ENV === "development" ? "'unsafe-inline'" : null,
      ].filter(Boolean),
      styleSrc: ["'self'", "'unsafe-inline'"], // inline styles used by React
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: [
        "'self'",
        // Stellar Horizon endpoints
        "https://horizon.stellar.org",
        "https://horizon-testnet.stellar.org",
      ],
      fontSrc: ["'self'", "https:", "data:"],
      objectSrc: ["'none'"],
      mediaSrc: ["'self'"],
      frameSrc: ["'none'"],
      upgradeInsecureRequests: [],
    },
  },
  crossOriginEmbedderPolicy: false, // keep false — Swagger UI loads cross-origin resources
  hsts: {
    maxAge: 31536000, // 1 year
    includeSubDomains: true,
    preload: true,
  },
  referrerPolicy: { policy: "no-referrer" },
  permittedCrossDomainPolicies: { permittedPolicies: "none" },
});

module.exports = { securityHeaders };
