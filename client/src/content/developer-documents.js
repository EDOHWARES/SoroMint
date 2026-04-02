export const developerDocuments = [
  {
    id: 'api-reference',
    category: 'Core API',
    title: 'API Reference',
    summary: 'Endpoints, payloads, and examples for the public SoroMint backend.',
    source: 'docs/api-documentation.md',
    markdown: `# SoroMint API Documentation

## Overview

The SoroMint API provides the backend surface area for token minting workflows, health checks, and developer tooling around Soroban integrations.

## Base URL

- Development: \`http://localhost:5000\`
- Interactive docs: \`http://localhost:5000/api-docs\`

## Core endpoints

### GET /api/health

Use this endpoint to verify that the server is online and that MongoDB is connected.

\`\`\`json
{
  "status": "healthy",
  "timestamp": "2026-03-24T10:30:56.000Z",
  "version": "1.0.0",
  "services": {
    "database": {
      "status": "up",
      "connection": "connected"
    },
    "stellar": {
      "network": "Test SDF Network ; September 2015"
    }
  }
}
\`\`\`

### GET /api/tokens/:owner

Fetch all tokens for a Stellar owner public key.

| Name | Type | Location | Required | Description |
| ---- | ---- | -------- | -------- | ----------- |
| \`owner\` | string | path | Yes | Stellar public key that owns the tokens |

\`\`\`bash
curl http://localhost:5000/api/tokens/GABC123...
\`\`\`

### POST /api/tokens

Create a new token record after a client-side wallet flow completes.

\`\`\`json
{
  "name": "SoroMint Token",
  "symbol": "SORO",
  "decimals": 7,
  "contractId": "CA3D5KRYM6CB7OWQ6TWYRR3Z4T7GNZLKERYNZGGA5SOAOPIFY6YQGAXE",
  "ownerPublicKey": "GBZ4XGQW5X6V7Y2Z3A4B5C6D7E8F9G0H1I2J3K4L5M6N7O8P9Q0R1S2T"
}
\`\`\`
`,
  },
  {
    id: 'backend-auth',
    category: 'Security',
    title: 'Authentication',
    summary: 'JWT-based auth flow for wallet-linked identities and protected routes.',
    source: 'docs/backend-auth.md',
    markdown: `# Backend Authentication

## Highlights

- JWT-based authentication
- Stellar public key identity model
- protected route middleware
- token refresh support

## Auth endpoints

### POST /api/auth/register

\`\`\`json
{
  "publicKey": "GDKIJJIKXLOM2NRMPNQZUUYK24ZPVFC64CZGCEVDEDG67DJKHS2XVLT5",
  "username": "myusername"
}
\`\`\`

### POST /api/auth/login

\`\`\`json
{
  "publicKey": "GDKIJJIKXLOM2NRMPNQZUUYK24ZPVFC64CZGCEVDEDG67DJKHS2XVLT5"
}
\`\`\`

## Environment

\`\`\`env
JWT_SECRET=your-super-secret-jwt-key-change-in-production
JWT_EXPIRES_IN=24h
\`\`\`

## Notes

Use a strong JWT secret in production and avoid committing it to version control.
`,
  },
  {
    id: 'validation',
    category: 'Security',
    title: 'Request Validation',
    summary: 'How token creation requests are validated and what error shapes clients should expect.',
    source: 'docs/api-validation.md',
    markdown: `# API Request Validation

Incoming token creation requests are validated with Zod before they reach the database layer.

## Token schema

| Field | Type | Constraints |
| ----- | ---- | ----------- |
| \`name\` | string | 3-50 chars |
| \`symbol\` | string | 2-12 chars, uppercase alphanumeric |
| \`decimals\` | number | integer, 0-18 |
| \`contractId\` | string | 56 chars, starts with \`C\` |
| \`ownerPublicKey\` | string | 56 chars, starts with \`G\` |

## Middleware example

\`\`\`javascript
router.post(
  "/tokens",
  authenticate,
  validateToken,
  asyncHandler(async (req, res) => {
    const { name, symbol, decimals, contractId, ownerPublicKey } = req.body;
    res.status(201).json({ name, symbol, decimals, contractId, ownerPublicKey });
  }),
);
\`\`\`

## Error shape

\`\`\`json
{
  "error": "name: Token name must be at least 3 characters long",
  "code": "VALIDATION_ERROR",
  "status": 400
}
\`\`\`
`,
  },
  {
    id: 'health-checks',
    category: 'Operations',
    title: 'Health Checks',
    summary: 'Operational guidance for uptime checks, infrastructure monitors, and frontend status widgets.',
    source: 'docs/health-checks.md',
    markdown: `# Health Check and Network Metadata

## Endpoint

- Method: \`GET\`
- Path: \`/api/health\`
- Auth: none

## Healthy response

\`\`\`json
{
  "status": "healthy",
  "timestamp": "2026-03-24T10:30:56.000Z",
  "version": "1.0.0",
  "uptime": "0h 15m 30s",
  "services": {
    "database": {
      "status": "up",
      "connection": "connected"
    },
    "stellar": {
      "network": "Test SDF Network ; September 2015"
    }
  }
}
\`\`\`

## Monitoring tip

Infrastructure checks should expect:

- \`200\` when the service is healthy
- \`503\` when MongoDB is unavailable
`,
  },
  {
    id: 'rate-limits',
    category: 'Operations',
    title: 'Rate Limiting',
    summary: 'Route protection defaults for login and token deployment endpoints.',
    source: 'docs/rate-limiting.md',
    markdown: `# API Rate Limiting

SoroMint protects high-risk routes with \`express-rate-limit\`.

## Protected routes

### POST /api/auth/login

- 5 requests per 15 minutes
- protects against repeated login attempts

### POST /api/tokens

- 10 requests per 60 minutes
- protects token deployment from burst abuse

## Error response

\`\`\`json
{
  "error": "Too many requests. Please try again later.",
  "code": "RATE_LIMIT_EXCEEDED",
  "status": 429
}
\`\`\`

## Tuning

\`\`\`env
LOGIN_RATE_LIMIT_WINDOW_MS=900000
LOGIN_RATE_LIMIT_MAX_REQUESTS=5
TOKEN_DEPLOY_RATE_LIMIT_WINDOW_MS=3600000
TOKEN_DEPLOY_RATE_LIMIT_MAX_REQUESTS=10
\`\`\`
`,
  },
  {
    id: 'backend-testing',
    category: 'Contributor Guide',
    title: 'Backend Testing',
    summary: 'How contributors can run targeted backend checks before opening PRs.',
    source: 'docs/backend-testing.md',
    markdown: `# Backend Testing Guide

## Why this matters

Contributor confidence comes from running the smallest useful test set before every PR.

## Recommended commands

\`\`\`bash
cd server
npm test
\`\`\`

## Good pre-PR habits

1. Run the route or middleware tests closest to your change.
2. Check the health endpoint after backend changes.
3. Verify auth and validation behavior when touching protected endpoints.

## Useful areas to inspect

- route tests for API behavior
- middleware tests for shared protection logic
- integration tests for end-to-end flows
`,
  },
]
