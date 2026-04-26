# Soroban RPC Failover Mechanism

This document describes the robust RPC failover mechanism implemented in SoroMint to ensure high availability and reliability for Soroban-based operations.

## Overview

The `FailoverRpcServer` class in `server/services/stellar-service.js` provides an automatic failover mechanism for Soroban RPC calls. It manages multiple RPC endpoints and automatically cycles through them if the current endpoint becomes unresponsive or returns an error.

## Configuration

To enable multiple RPC endpoints, update your `.env` file with the `SOROBAN_RPC_URLS` variable.

### Environment Variables

- `SOROBAN_RPC_URLS`: A comma-separated list of Soroban RPC endpoint URLs.
- `SOROBAN_RPC_URL`: (Deprecated) The primary Soroban RPC endpoint URL. Used as a fallback if `SOROBAN_RPC_URLS` is not provided.

### Example `.env`

```env
SOROBAN_RPC_URLS=https://soroban-testnet.stellar.org,https://another-rpc-endpoint.com,https://backup-rpc.stellar.org
NETWORK_PASSPHRASE=Test SDF Network ; September 2015
```

## How It Works

1. **Initialization**: On startup, `getRpcServer()` reads the configured URLs and initializes a `FailoverRpcServer` instance with an array of `rpc.Server` objects.
2. **Execution**: All RPC calls should be wrapped using the `execute(fn)` method of the `FailoverRpcServer` instance.
3. **Failover Logic**:
    - If an RPC call fails, the error is logged.
    - The server automatically switches to the next configured RPC endpoint (round-robin).
    - The call is retried with the new endpoint.
    - This process continues until the call succeeds or all configured endpoints have been tried.
4. **Logging**: All failover events are logged with `warn` or `error` levels, providing visibility into the health of the RPC connections.

## Usage Example

```javascript
const { getRpcServer } = require('./services/stellar-service');

const rpcServer = getRpcServer();

try {
  const result = await rpcServer.execute(async (server) => {
    return await server.getLatestLedger();
  });
  console.log('Latest Ledger:', result);
} catch (error) {
  console.error('All RPC endpoints failed:', error.message);
}
```

## Benefits

- **Redundancy**: Prevents a single point of failure for RPC connectivity.
- **Reliability**: Improves the overall stability of the application.
- **Ease of Use**: The failover logic is abstracted away from the business logic.
