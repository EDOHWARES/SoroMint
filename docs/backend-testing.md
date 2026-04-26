# Backend Testing Guide

## Overview

SoroMint uses a two-layer testing strategy:

| Layer | Tool | Scope | Location |
|-------|------|-------|----------|
| **Unit Tests** | Jest + Supertest | Individual routes/middleware/config in isolation | `server/tests/{routes,middleware,config,utils}/` |
| **Integration Tests** | Jest + Supertest | End-to-end workflows across all components | `server/tests/integration.test.js` |

Both layers use [MongoDB Memory Server](https://github.com/nodkz/mongodb-memory-server) for an isolated, ephemeral database — no external MongoDB required.

---

## Running Tests

```bash
# From the server/ directory

# Run all tests with coverage
npm test

# Watch mode (re-runs on file changes)
npm run test:watch
```

Coverage reports are printed to stdout and include line, branch, function, and statement coverage.

---

## Integration Tests

The integration test file (`server/tests/integration.test.js`) exercises complete user workflows that span multiple components:

### Flow 1 — Token Lifecycle
Register → Create Token → List Tokens → Search → Verify Audit  
*Validates the primary happy path as described in the API documentation.*

### Flow 2 — Auth → Audit Log Flow
Register → Login → Create Token → Query Audit Logs → Refresh JWT  
*Ensures JWT tokens produced by registration, login, and refresh all work for authenticated endpoints.*

### Flow 3 — Multi-User Isolation
Register two users → each creates tokens → verify data boundaries  
*Confirms that users cannot see each other's tokens or audit logs.*

### Flow 4 — Error Propagation
No-auth requests → invalid validation → duplicate keys → 404 routes  
*Validates that Zod validation errors, Mongoose duplicate-key errors, and auth failures propagate correctly through the error handler middleware.*

### Flow 5 — Health Check
GET `/api/health` with live MongoMemoryServer connection  
*Verifies the health endpoint reports accurate database and network status.*

---

## Test Database

All tests use `mongodb-memory-server`, which:
- Downloads and runs a local MongoDB binary in-memory
- Requires **no external MongoDB** instance
- Automatically cleans up on process exit
- Provides a unique connection URI per test suite

Each test suite manages its own cleanup via `afterAll` / `afterEach` hooks.

---

## CI Integration

Add this step to your CI pipeline (GitHub Actions example):

```yaml
- name: Run backend tests
  working-directory: server
  run: |
    npm ci
    npm test -- --ci --coverage --forceExit
```

> [!NOTE]
> The `--forceExit` flag ensures Jest exits after tests complete, preventing hanging from open MongoMemoryServer handles.

---

## Writing New Tests

When adding tests, follow these conventions:

1. **NatSpec-style comments** — Use `@title`, `@notice`, `@dev` JSDoc tags
2. **MongoMemoryServer** — Always use in-memory DB, never connect to a real instance
3. **Cleanup** — Clear collections in `afterEach` / `afterAll` hooks
4. **Descriptive test names** — Use `should <verb> <description>` format
5. **Real JWT tokens** — Use `generateToken()` from `middleware/auth.js`, not mock tokens
