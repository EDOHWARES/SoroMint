# SoroMint Backend Testing Guide

## Overview

SoroMint uses [Jest](https://jestjs.io/) and [Supertest](https://github.com/visionmedia/supertest) for backend testing, with [MongoDB Memory Server](https://github.com/nodkz/mongodb-memory-server) to provide an isolated, in-memory database instance for integration tests.

The goal is to maintain at least **95% test coverage** for all server components.

## Running Tests

To run the complete test suite including unit and integration tests across all routes, middleware, and utilities:

```bash
cd server
npm test
```

This command automatically generates a coverage report and requires no local MongoDB instance to be running.

### Watch Mode

If you are developing new tests and want Jest to automatically rerun them on file changes:

```bash
npm run test:watch
```

## Architecture

1. **Jest Configuration (`server/jest.config.js`)**
   Configures Jest to use Node environment and points to the global setup script.

2. **Test Setup (`server/tests/setup.js`)**
   Provides mock environment variables required by `envalid` (via `server/config/env-config.js`), ensuring our app boots successfully without throwing errors over missing configuration logs. The in-memory MongoDB connection ensures that integration tests don't pollute the real database.

3. **Express App Mocking**
   `server/index.js` checks if `process.env.NODE_ENV !== 'test'` before connecting to the database or starting the web server. This allows tests to import the `app` seamlessly using `const app = require('../index');` and pass it to Supertest (`request(app)`).

## Writing new End-to-End Tests

When writing new integration tests in `server/tests/integration.test.js`, please ensure that:
1. NatSpec-style comments (JSdoc) are added at the top of test blocks explaining what the block covers.
2. Full lifecycle operations are exercised: `Create` -> `List` -> `Search`.
3. Valid Stellar public keys (e.g., Ed25519 standard `G...`) and Contract IDs (e.g., standard `C...` length of 56 chars) are used for payloads since the request validators strictly enforce parameter shapes.
