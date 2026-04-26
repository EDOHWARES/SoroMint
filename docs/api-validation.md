# API Request Validation

This document describes the request validation logic implemented in the SoroMint backend using the [Zod](https://zod.dev/) library.

## Overview

To ensure data integrity and prevent malformed data from reaching the database, all incoming POST request bodies are validated against predefined schemas. This approach provides:

- Clear and consistent error messages for API clients.
- Type safety and data transformation (e.g., default values, trimming).
- Automated logging of validation failures for auditing.

## Token Validation Schema

The `tokenSchema` is defined in `server/validators/token-validator.js` and enforces the following rules for creating new tokens:

| Field            | Type   | Constraints                        | Description                            |
| ---------------- | ------ | ---------------------------------- | -------------------------------------- |
| `name`           | String | 3-50 chars                         | Human-readable token name.             |
| `symbol`         | String | 2-12 chars, Alphanumeric Uppercase | Token ticker symbol.                   |
| `decimals`       | Number | 0-18, Integer                      | Number of decimal places (Default: 7). |
| `contractId`     | String | 56 chars, Starts with 'C'          | Soroban contract ID.                   |
| `ownerPublicKey` | String | 56 chars, Starts with 'G'          | Stellar owner public key.              |

## Implementation Details

### Validation Middleware

The `validateToken` middleware is used in `server/routes/token-routes.js`:

```javascript
const { validateToken } = require("../validators/token-validator");

router.post(
  "/tokens",
  authenticate,
  validateToken,
  asyncHandler(async (req, res) => {
    // At this point, req.body is guaranteed to be valid and typed
    const { name, symbol, decimals, contractId, ownerPublicKey } = req.body;
    // ... rest of the logic
  }),
);
```

### Error Responses

When validation fails, the API returns a `400 Bad Request` with a structured error response:

**Example Error Response:**

```json
{
  "error": "name: Token name must be at least 3 characters long, symbol: Token symbol must be alphanumeric and uppercase",
  "code": "VALIDATION_ERROR",
  "status": 400
}
```

### Auditing

Every validation failure is automatically logged to the `DeploymentAudit` collection in MongoDB with a `status: 'FAIL'` and a descriptive `errorMessage`, allowing administrators to track blocked malformed requests.
