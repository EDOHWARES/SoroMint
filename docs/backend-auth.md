# SoroMint Backend Authentication System

## Overview

The SoroMint authentication system uses **JSON Web Tokens (JWT)** to provide secure, stateless authentication for users interacting with the Stellar blockchain. Users authenticate using their Stellar public keys, making the system ideal for Web3 applications.

## Architecture

```
┌─────────────┐     ┌──────────────┐     ┌─────────────┐
│   Client    │────▶│  Auth Routes │────▶│  User Model │
│  (Wallet)   │◀────│  & Middleware│◀────│  (MongoDB)  │
└─────────────┘     └──────────────┘     └─────────────┘
                           │
                           ▼
                    ┌──────────────┐
                    │ JWT Service  │
                    │  (Sign/Verify)│
                    └──────────────┘
```

## Features

- ✅ **JWT-based Authentication**: Secure, stateless token-based auth
- ✅ **Stellar Public Key Integration**: Users authenticate with their G-address
- ✅ **Challenge/Response Ready**: Infrastructure in place for signature verification (MVP uses simple public key check)
- ✅ **Protected Routes**: Middleware to secure sensitive API endpoints
- ✅ **Token Refresh**: Ability to refresh expired tokens
- ✅ **Account Status Management**: Support for active, suspended, and deleted accounts
- ✅ **Comprehensive Error Handling**: Standardized error responses with error codes

## Installation

### 1. Install Dependencies

```bash
cd server
npm install jsonwebtoken
```

### 2. Configure Environment Variables

Add the following to your `.env` file:

```env
# JWT Authentication Configuration
JWT_SECRET=your-super-secret-jwt-key-change-in-production
JWT_EXPIRES_IN=24h
```

> ⚠️ **Security Warning**: Always use a strong, randomly generated secret in production. Never commit your production JWT_SECRET to version control.

## API Endpoints

### Authentication Routes

All authentication endpoints are prefixed with `/api/auth`.

#### 1. Register User

**POST** `/api/auth/register`

Registers a new user with their Stellar public key.

**Request Body:**
```json
{
  "publicKey": "GDKIJJIKXLOM2NRMPNQZUUYK24ZPVFC64CZGCEVDEDG67DJKHS2XVLT5",
  "username": "myusername"
}
```

**Response (201 Created):**
```json
{
  "success": true,
  "message": "Registration successful",
  "data": {
    "user": {
      "id": "65f1234567890abcdef12345",
      "publicKey": "GDKIJJIKXLOM2NRMPNQZUUYK24ZPVFC64CZGCEVDEDG67DJKHS2XVLT5",
      "username": "myusername",
      "createdAt": "2024-01-15T10:30:00.000Z"
    },
    "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "expiresIn": "24h"
  }
}
```

**Error Responses:**
- `400 Bad Request` - Invalid or missing public key
- `409 Conflict` - User already exists

---

#### 2. Login

**POST** `/api/auth/login`

Authenticates an existing user and returns a JWT token.

**Request Body:**
```json
{
  "publicKey": "GDKIJJIKXLOM2NRMPNQZUUYK24ZPVFC64CZGCEVDEDG67DJKHS2XVLT5"
}
```

**Optional (Future Enhancement):**
```json
{
  "publicKey": "GDKIJJIKXLOM2NRMPNQZUUYK24ZPVFC64CZGCEVDEDG67DJKHS2XVLT5",
  "challenge": "random-challenge-string",
  "signature": "signature-of-challenge"
}
```

**Response (200 OK):**
```json
{
  "success": true,
  "message": "Login successful",
  "data": {
    "user": {
      "id": "65f1234567890abcdef12345",
      "publicKey": "GDKIJJIKXLOM2NRMPNQZUUYK24ZPVFC64CZGCEVDEDG67DJKHS2XVLT5",
      "username": "myusername",
      "lastLoginAt": "2024-01-15T10:30:00.000Z"
    },
    "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "expiresIn": "24h"
  }
}
```

**Error Responses:**
- `400 Bad Request` - Invalid or missing public key
- `401 Unauthorized` - User not found
- `403 Forbidden` - Account suspended or deleted

---

#### 3. Get Current User

**GET** `/api/auth/me`

Retrieves the authenticated user's profile.

**Headers:**
```
Authorization: Bearer <JWT token>
```

**Response (200 OK):**
```json
{
  "success": true,
  "data": {
    "user": {
      "id": "65f1234567890abcdef12345",
      "publicKey": "GDKIJJIKXLOM2NRMPNQZUUYK24ZPVFC64CZGCEVDEDG67DJKHS2XVLT5",
      "username": "myusername",
      "status": "active",
      "createdAt": "2024-01-15T10:30:00.000Z",
      "lastLoginAt": "2024-01-15T10:30:00.000Z"
    }
  }
}
```

**Error Responses:**
- `401 Unauthorized` - Missing, invalid, or expired token

---

#### 4. Refresh Token

**POST** `/api/auth/refresh`

Generates a new JWT token for the authenticated user.

**Headers:**
```
Authorization: Bearer <JWT token>
```

**Response (200 OK):**
```json
{
  "success": true,
  "message": "Token refreshed successfully",
  "data": {
    "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "expiresIn": "24h"
  }
}
```

**Error Responses:**
- `401 Unauthorized` - Invalid or expired token

---

#### 5. Update Profile

**PUT** `/api/auth/profile`

Updates the authenticated user's profile information.

**Headers:**
```
Authorization: Bearer <JWT token>
```

**Request Body:**
```json
{
  "username": "newusername"
}
```

**Response (200 OK):**
```json
{
  "success": true,
  "message": "Profile updated successfully",
  "data": {
    "user": {
      "id": "65f1234567890abcdef12345",
      "publicKey": "GDKIJJIKXLOM2NRMPNQZUUYK24ZPVFC64CZGCEVDEDG67DJKHS2XVLT5",
      "username": "newusername",
      "status": "active",
      "lastLoginAt": "2024-01-15T10:30:00.000Z"
    }
  }
}
```

**Error Responses:**
- `400 Bad Request` - Invalid username format
- `401 Unauthorized` - Invalid or expired token

---

## Protecting Routes

### Using the `authenticate` Middleware

To protect a route, import and use the `authenticate` middleware:

```javascript
const { authenticate } = require('./middleware/auth');

// Protected route
app.post('/api/tokens', authenticate, async (req, res) => {
  // req.user contains the authenticated user
  // req.token contains the decoded JWT payload
  const { name, symbol } = req.body;
  const newToken = new Token({
    name,
    symbol,
    ownerPublicKey: req.user.publicKey
  });
  await newToken.save();
  res.json(newToken);
});
```

### Using Optional Authentication

For routes that behave differently for authenticated vs anonymous users:

```javascript
const { optionalAuthenticate } = require('./middleware/auth');

app.get('/api/public-data', optionalAuthenticate, (req, res) => {
  if (req.user) {
    // Return personalized data
    res.json({ authenticated: true, data: getUserData(req.user) });
  } else {
    // Return public data
    res.json({ authenticated: false, data: getPublicData() });
  }
});
```

### Using Role-Based Authorization

For routes requiring specific roles (extensible for future use):

```javascript
const { authenticate, authorize } = require('./middleware/auth');

app.delete('/api/admin/users/:id',
  authenticate,
  authorize('admin'),
  async (req, res) => {
    // Only users with 'admin' role can access
    await User.findByIdAndDelete(req.params.id);
    res.json({ success: true });
  }
);
```

## JWT Token Structure

### Payload

```json
{
  "publicKey": "GDKIJJIKXLOM2NRMPNQZUUYK24ZPVFC64CZGCEVDEDG67DJKHS2XVLT5",
  "username": "myusername",
  "type": "access",
  "iss": "SoroMint",
  "aud": "SoroMint-API",
  "iat": 1705312200,
  "exp": 1705398600
}
```

### Claims

| Claim | Description |
|-------|-------------|
| `publicKey` | User's Stellar public key (G-address) |
| `username` | Optional username |
| `type` | Token type (always "access") |
| `iss` | Issuer ("SoroMint") |
| `aud` | Audience ("SoroMint-API") |
| `iat` | Issued at timestamp |
| `exp` | Expiration timestamp |

## Security Considerations

### 1. JWT Secret Management

- Use a strong, randomly generated secret (minimum 32 characters)
- Store secrets in environment variables, never in code
- Rotate secrets periodically in production
- Use different secrets for different environments

### 2. Token Expiration

- Default expiration: 24 hours
- Configure via `JWT_EXPIRES_IN` environment variable
- Implement token refresh mechanism for long-lived sessions
- Consider shorter expiration for sensitive operations

### 3. HTTPS Only

- Always use HTTPS in production
- Tokens transmitted over HTTP can be intercepted
- Configure your server to reject non-HTTPS requests in production

### 4. Public Key Validation

- All public keys are validated using Stellar SDK's `StrKey.isValidEd25519PublicKey()`
- Keys are normalized to uppercase for consistency
- Invalid keys are rejected with clear error messages

### 5. Account Status Checks

- Every authentication checks account status
- Suspended or deleted accounts are rejected
- Status checks happen after token verification

## Future Enhancements

### Challenge/Response Authentication

The current MVP uses simple public key verification. For enhanced security, implement challenge/response:

```javascript
// 1. Client requests a challenge
POST /api/auth/challenge
{ "publicKey": "G..." }

// 2. Server returns a random challenge string
{ "challenge": "random-string-12345" }

// 3. Client signs challenge with their secret key
// 4. Client sends signature with login
POST /api/auth/login
{
  "publicKey": "G...",
  "challenge": "random-string-12345",
  "signature": "signed-challenge"
}

// 5. Server verifies signature using public key
```

### Refresh Token Rotation

Implement refresh token rotation for enhanced security:

```javascript
// Access token: short-lived (15 minutes)
// Refresh token: long-lived (7 days), stored in database
// Each refresh invalidates the old refresh token
```

### Rate Limiting

Add rate limiting to prevent brute force attacks:

```javascript
const rateLimit = require('express-rate-limit');

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // 5 attempts per window
  message: 'Too many authentication attempts, please try again later'
});

app.post('/api/auth/login', authLimiter, loginHandler);
```

## Testing

### Run Tests

```bash
npm test
```

### Run with Coverage

```bash
npm test -- --coverage
```

### Test Files

- `server/tests/middleware/auth.test.js` - Auth middleware tests
- `server/tests/routes/auth-routes.test.js` - Auth routes tests

### Test Coverage Requirements

- Minimum coverage: **95%+**
- All critical paths tested
- Edge cases covered
- Error scenarios validated

## Error Codes

| Code | HTTP Status | Description |
|------|-------------|-------------|
| `AUTH_REQUIRED` | 401 | No token provided |
| `INVALID_TOKEN` | 401 | Token format is invalid |
| `TOKEN_EXPIRED` | 401 | Token has expired |
| `USER_NOT_FOUND` | 401 | User doesn't exist |
| `ACCOUNT_INACTIVE` | 403 | Account suspended or deleted |
| `INVALID_PUBLIC_KEY` | 400 | Invalid Stellar public key format |
| `USER_EXISTS` | 409 | User already registered |
| `VALIDATION_ERROR` | 400 | Request validation failed |

## Example Usage (Client-Side)

### JavaScript/TypeScript

```typescript
// Register
const register = async (publicKey: string, username?: string) => {
  const response = await fetch('/api/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ publicKey, username })
  });
  const data = await response.json();
  localStorage.setItem('token', data.data.token);
  return data;
};

// Login
const login = async (publicKey: string) => {
  const response = await fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ publicKey })
  });
  const data = await response.json();
  localStorage.setItem('token', data.data.token);
  return data;
};

// Protected API call
const createToken = async (tokenData: any) => {
  const token = localStorage.getItem('token');
  const response = await fetch('/api/tokens', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify(tokenData)
  });
  return response.json();
};
```

## Contributing

When adding new authenticated routes:

1. Import the `authenticate` middleware
2. Apply it to your route handler
3. Access user data via `req.user`
4. Add appropriate error handling
5. Write tests for your route

## Support

For issues or questions:
- Check existing documentation
- Review error codes in this document
- Open an issue on GitHub

---

**Last Updated**: March 2026  
**Version**: 1.0.0  
**Author**: SoroMint Team
