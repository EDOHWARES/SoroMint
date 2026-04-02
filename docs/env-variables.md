# Environment Variables Documentation

## Overview

This document describes all environment variables used by the SoroMint backend server. The application uses a fail-fast validation mechanism that prevents the server from starting if any required environment variable is missing or invalid.

## Validation Mechanism

The server uses [envalid](https://github.com/af/envalid) to validate environment variables during startup. If validation fails, the server will:

1. Log the specific validation error
2. Display a clear error message in the console
3. Exit with code 1 (preventing the server from starting)

## Required Environment Variables

### Database Configuration

| Variable    | Type | Description               | Example                              |
| ----------- | ---- | ------------------------- | ------------------------------------ |
| `MONGO_URI` | URL  | MongoDB connection string | `mongodb://localhost:27017/soromint` |

### JWT Authentication

| Variable     | Type   | Description                       | Example                     |
| ------------ | ------ | --------------------------------- | --------------------------- |
| `JWT_SECRET` | String | Secret key for signing JWT tokens | `your-super-secret-jwt-key` |

### Stellar/Soroban Configuration

| Variable    | Type | Description             | Example                  |
| ----------- | ---- | ----------------------- | ------------------------ |
| `REDIS_URL` | URL  | Redis connection string | `redis://127.0.0.1:6379` |

---

| Variable          | Type | Description          | Example                               |
| ----------------- | ---- | -------------------- | ------------------------------------- |
| `SOROBAN_RPC_URL` | URL  | Soroban RPC endpoint | `https://soroban-testnet.stellar.org` |

## Optional Environment Variables

### Server Configuration

| Variable   | Type   | Default       | Description                                                   |
| ---------- | ------ | ------------- | ------------------------------------------------------------- |
| `PORT`     | Port   | `5000`        | Port number for the Express server                            |
| `NODE_ENV` | String | `development` | Application environment (`development`, `production`, `test`) |
| `CORS_ALLOWED_ORIGINS` | String | Localhost frontend origins in non-production, empty in production | Comma-separated whitelist of allowed browser origins (example: `https://app.example.com,https://admin.example.com`) |

### JWT Authentication

| Variable         | Type   | Default | Description               |
| ---------------- | ------ | ------- | ------------------------- |
| `JWT_EXPIRES_IN` | String | `24h`   | JWT token expiration time |

### Stellar/Soroban Configuration

| Variable             | Type   | Default                             | Description                                       |
| -------------------- | ------ | ----------------------------------- | ------------------------------------------------- |
| `NETWORK_PASSPHRASE` | String | `Test SDF Network ; September 2015` | Stellar network passphrase                        |
| `ADMIN_SECRET_KEY`   | String | `""`                                | Optional admin secret key for server-side signing |

### Caching Configuration

| Variable          | Type   | Default | Description                                    |
| ----------------- | ------ | ------- | ---------------------------------------------- |
| `REDIS_CACHE_TTL` | Number | `3600`  | Default Time-To-Live for cache keys in seconds |

## Example .env File

```bash
# Server Configuration
PORT=5000
NODE_ENV=development
CORS_ALLOWED_ORIGINS=http://localhost:5173,http://127.0.0.1:5173

# Database Configuration (REQUIRED)
MONGO_URI=mongodb://localhost:27017/soromint

# JWT Authentication (REQUIRED)
JWT_SECRET=YOUR_JWT_SECRET_HERE
JWT_EXPIRES_IN=24h

# Redis Caching (REQUIRED)
REDIS_URL=redis://127.0.0.1:6379
REDIS_CACHE_TTL=3600

# Stellar / Soroban Configuration (REQUIRED)
SOROBAN_RPC_URL=https://soroban-testnet.stellar.org
NETWORK_PASSPHRASE=Test SDF Network ; September 2015

# Optional: for server-side signing if needed
ADMIN_SECRET_KEY=S...
```

## Error Messages

If environment validation fails, you'll see an error message like:

```
❌ Environment Validation Error:
  EnvError: Invalid url: MONGO_URI

Please check your .env file and ensure all required variables are set.
See docs/env-variables.md for more information.
```

Common validation errors:

- **Missing required variable**: The variable is not defined in your `.env` file
- **Invalid URL**: The variable must be a valid URL (e.g., `MONGO_URI`, `SOROBAN_RPC_URL`)
- **Invalid port**: The `PORT` variable must be a valid port number (1-65535)
- **Invalid choice**: The `NODE_ENV` must be one of: `development`, `production`, `test`

## Implementation Details

The environment validation is implemented in `server/config/env-config.js`. Key features:

1. **Fail-fast validation**: Environment is validated before any other modules are loaded
2. **Type coercion**: Values are automatically converted to appropriate types
3. **Default values**: Optional variables have sensible defaults
4. **Secure logging**: Database credentials are masked in log output
5. **Strict CORS parsing**: Allowed origins are normalized and invalid entries fail startup
6. **Clear errors**: Human-readable error messages guide users to fix issues

## Testing

To test the environment validation:

1. **Missing variables test**:

   ```bash
   # Temporarily rename .env file
   mv .env .env.backup
   npm start
   # Should exit with validation error
   ```

2. **Invalid URL test**:
   ```bash
   # Set invalid MONGO_URI
   MONGO_URI=not-a-valid-url npm start
   # Should exit with URL validation error
   ```

## Security Considerations

1. **Never commit `.env` files** to version control
2. **Use strong JWT secrets** in production (at least 32 characters)
3. **Rotate secrets regularly** in production environments
4. **Use different JWT secrets** for different environments
5. **Restrict MongoDB access** using authentication and network rules
6. **Set `CORS_ALLOWED_ORIGINS` explicitly in production** so only trusted frontends can call the API from browsers
