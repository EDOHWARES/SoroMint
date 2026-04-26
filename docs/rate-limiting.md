# SoroMint API Rate Limiting

## Overview

SoroMint protects high-risk backend routes with `express-rate-limit` to reduce brute-force login attempts and accidental or abusive token deployment traffic.

## Protected Routes

### `POST /api/auth/login`

- Default limit: 5 requests per 15 minutes
- Purpose: slow repeated login attempts against a Stellar public key

### `POST /api/tokens`

- Default limit: 10 requests per 60 minutes
- Purpose: protect token deployment from burst abuse and repeated submission loops

## Error Response

When a client exceeds a configured limit, the API returns a standard `429 Too Many Requests` response:

```json
{
  "error": "Too many requests. Please try again later.",
  "code": "RATE_LIMIT_EXCEEDED",
  "status": 429
}
```

## Configuration

The default values can be tuned with environment variables:

```env
LOGIN_RATE_LIMIT_WINDOW_MS=900000
LOGIN_RATE_LIMIT_MAX_REQUESTS=5
TOKEN_DEPLOY_RATE_LIMIT_WINDOW_MS=3600000
TOKEN_DEPLOY_RATE_LIMIT_MAX_REQUESTS=10
```

All values must be positive integers. If a value is missing or invalid, SoroMint falls back to the documented default.

## Verification

Run the backend test suite to confirm both limited routes reject requests after the configured threshold:

```bash
cd server
npm test
```
