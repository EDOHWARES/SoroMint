# SoroMint API Documentation

## Overview

The SoroMint API provides a comprehensive interface for managing Soroban token minting operations on the Stellar network. This documentation covers all available endpoints, data models, and usage examples.

## Base URL

- **Development**: `http://localhost:5000`
- **Production**: `https://api.soromint.com` (future)

## Interactive Documentation

For interactive API exploration, visit `/api-docs` when the server is running. This provides a Swagger UI interface where you can:
- Browse all available endpoints
- View request/response schemas
- Test API calls directly from the browser
- Download the OpenAPI specification

## Authentication

Currently, the API does not require authentication. In production environments, API keys or JWT tokens should be implemented for secure access.

## Rate Limiting

Rate limiting is not currently implemented. Consider implementing rate limiting in production to prevent abuse.

---

## Endpoints

### System Endpoints

#### GET /api/status

Retrieves the current server status and network configuration.

**Parameters**: None

**Response**: `200 OK`

```json
{
  "status": "Server is running",
  "network": "Test SDF Network ; September 2015"
}
```

**Error Response**: `default`

```json
{
  "error": "An unexpected error occurred",
  "code": "INTERNAL_ERROR"
}
```

---

### Token Endpoints

#### GET /api/tokens/:owner

Retrieves all tokens owned by a specific Stellar public key.

**Parameters**:

| Name   | Type   | Location | Required | Description                        |
| ------ | ------ | -------- | -------- | ---------------------------------- |
| `owner` | string | path     | Yes      | Owner's Stellar public key (G...)  |

**Response**: `200 OK`

```json
[
  {
    "_id": "507f1f77bcf86cd799439011",
    "name": "SoroMint Token",
    "symbol": "SORO",
    "decimals": 7,
    "contractId": "CA3D5KRYM6CB7OWQ6TWYRR3Z4T7GNZLKERYNZGGA5SOAOPIFY6YQGAXE",
    "ownerPublicKey": "GBZ4XGQW5X6V7Y2Z3A4B5C6D7E8F9G0H1I2J3K4L5M6N7O8P9Q0R1S2T",
    "createdAt": "2024-01-15T10:30:00.000Z"
  }
]
```

**Error Response**: `400 Bad Request`

```json
{
  "error": "Invalid owner public key format",
  "code": "INVALID_ID",
  "status": 400
}
```

---

#### POST /api/tokens

Creates a new Soroban token record.

**Parameters**: None (body required)

**Request Body**:

```json
{
  "name": "SoroMint Token",
  "symbol": "SORO",
  "decimals": 7,
  "contractId": "CA3D5KRYM6CB7OWQ6TWYRR3Z4T7GNZLKERYNZGGA5SOAOPIFY6YQGAXE",
  "ownerPublicKey": "GBZ4XGQW5X6V7Y2Z3A4B5C6D7E8F9G0H1I2J3K4L5M6N7O8P9Q0R1S2T"
}
```

**Required Fields**:
- `name` (string): Full name of the token
- `symbol` (string): Token symbol/ticker
- `ownerPublicKey` (string): Owner's Stellar public key

**Optional Fields**:
- `decimals` (number): Number of decimal places (default: 7)
- `contractId` (string): Stellar contract address

**Response**: `201 Created`

```json
{
  "_id": "507f1f77bcf86cd799439011",
  "name": "SoroMint Token",
  "symbol": "SORO",
  "decimals": 7,
  "contractId": "CA3D5KRYM6CB7OWQ6TWYRR3Z4T7GNZLKERYNZGGA5SOAOPIFY6YQGAXE",
  "ownerPublicKey": "GBZ4XGQW5X6V7Y2Z3A4B5C6D7E8F9G0H1I2J3K4L5M6N7O8P9Q0R1S2T",
  "createdAt": "2024-01-15T10:30:00.000Z"
}
```

**Error Response**: `400 Bad Request` (Validation Error)

```json
{
  "error": "Missing required fields: name, symbol, and ownerPublicKey are required",
  "code": "VALIDATION_ERROR",
  "status": 400
}
```

**Error Response**: `409 Conflict` (Duplicate Key)

```json
{
  "error": "contractId already exists",
  "code": "DUPLICATE_KEY",
  "status": 409
}
```

---

## Data Models

### Token

Represents a Soroban token on the Stellar network.

| Field            | Type   | Required | Default | Description                              |
| ---------------- | ------ | -------- | ------- | ---------------------------------------- |
| `_id`            | string | Auto     | -       | MongoDB ObjectId                         |
| `name`           | string | Yes      | -       | Full name of the token (1-100 chars)     |
| `symbol`         | string | Yes      | -       | Token symbol/ticker (1-10 chars)         |
| `decimals`       | number | No       | 7       | Number of decimal places (0-18)          |
| `contractId`     | string | Yes      | -       | Stellar contract address (C... format)   |
| `ownerPublicKey` | string | Yes      | -       | Owner's Stellar public key (G... format) |
| `createdAt`      | date   | Auto     | now     | Token creation timestamp                 |

### TokenCreateInput

Input schema for creating a new token.

| Field            | Type   | Required | Default | Description                              |
| ---------------- | ------ | -------- | ------- | ---------------------------------------- |
| `name`           | string | Yes      | -       | Full name of the token                   |
| `symbol`         | string | Yes      | -       | Token symbol/ticker                      |
| `decimals`       | number | No       | 7       | Number of decimal places                 |
| `contractId`     | string | No       | -       | Stellar contract address                 |
| `ownerPublicKey` | string | Yes      | -       | Owner's Stellar public key               |

---

## Error Handling

All API errors follow a standardized format:

```json
{
  "error": "Human-readable error message",
  "code": "ERROR_CODE",
  "status": 400
}
```

### Error Codes

| Code                 | HTTP Status | Description                                    |
| -------------------- | ----------- | ---------------------------------------------- |
| `VALIDATION_ERROR`   | 400         | Request validation failed                      |
| `INVALID_ID`         | 400         | Invalid ObjectId or public key format          |
| `DUPLICATE_KEY`      | 409         | Resource already exists                        |
| `NOT_FOUND`          | 404         | Requested resource not found                   |
| `ROUTE_NOT_FOUND`    | 404         | API endpoint does not exist                    |
| `INTERNAL_ERROR`     | 500         | Unexpected server error                        |
| `INVALID_TOKEN`      | 401         | Invalid authentication token (future)          |
| `TOKEN_EXPIRED`      | 401         | Authentication token expired (future)          |
| `SYNTAX_ERROR`       | 400         | Invalid request payload (e.g., malformed JSON) |

### Development Mode

In development mode (`NODE_ENV=development`), error responses include additional debugging information:

```json
{
  "error": "Error message",
  "code": "ERROR_CODE",
  "status": 400,
  "stack": "Error: ...\n  at ..."
}
```

---

## Usage Examples

### JavaScript (Fetch API)

```javascript
// Get tokens by owner
const response = await fetch('http://localhost:5000/api/tokens/GBZ4XGQW5X6V7Y2Z3A4B5C6D7E8F9G0H1I2J3K4L5M6N7O8P9Q0R1S2T');
const tokens = await response.json();

// Create a new token
const newToken = await fetch('http://localhost:5000/api/tokens', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    name: 'My Token',
    symbol: 'MYT',
    decimals: 7,
    ownerPublicKey: 'GBZ4XGQW5X6V7Y2Z3A4B5C6D7E8F9G0H1I2J3K4L5M6N7O8P9Q0R1S2T'
  })
});
```

### cURL

```bash
# Get tokens by owner
curl http://localhost:5000/api/tokens/GBZ4XGQW5X6V7Y2Z3A4B5C6D7E8F9G0H1I2J3K4L5M6N7O8P9Q0R1S2T

# Create a new token
curl -X POST http://localhost:5000/api/tokens \
  -H "Content-Type: application/json" \
  -d '{
    "name": "My Token",
    "symbol": "MYT",
    "decimals": 7,
    "ownerPublicKey": "GBZ4XGQW5X6V7Y2Z3A4B5C6D7E8F9G0H1I2J3K4L5M6N7O8P9Q0R1S2T"
  }'

# Check server status
curl http://localhost:5000/api/status
```

### Python (requests)

```python
import requests

# Get tokens by owner
response = requests.get('http://localhost:5000/api/tokens/GBZ4XGQW5X6V7Y2Z3A4B5C6D7E8F9G0H1I2J3K4L5M6N7O8P9Q0R1S2T')
tokens = response.json()

# Create a new token
new_token = requests.post('http://localhost:5000/api/tokens', json={
    'name': 'My Token',
    'symbol': 'MYT',
    'decimals': 7,
    'ownerPublicKey': 'GBZ4XGQW5X6V7Y2Z3A4B5C6D7E8F9G0H1I2J3K4L5M6N7O8P9Q0R1S2T'
})
```

---

## Network Configuration

The API supports multiple Stellar networks:

| Network   | Passphrase                                      | Use Case          |
| --------- | ----------------------------------------------- | ----------------- |
| Futurenet | `Future Network ; October 2022`                 | Soroban testing   |
| Testnet   | `Test SDF Network ; September 2015`             | General testing   |
| Mainnet   | `Public Global Stellar Network ; September 2015`| Production        |

Configure the network via environment variables:

```bash
NETWORK_PASSPHRASE="Test SDF Network ; September 2015"
SOROBAN_RPC_URL="https://soroban-test.stellar.org"
```

---

## Support

For issues, feature requests, or contributions, please refer to the [GitHub repository](https://github.com/EDOHWARES/SoroMint).
