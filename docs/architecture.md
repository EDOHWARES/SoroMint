# Architecture

SoroMint is a full-stack token platform built around a React client, an Express API, MongoDB, Stellar RPC, and a collection of Soroban smart contracts.

## Request flow

1. The client connects to Freighter and submits user actions to the backend API.
2. Express routes authenticate and validate requests before calling a service.
3. Services read or persist application state in MongoDB and construct Stellar transactions.
4. Transactions are simulated and submitted through the configured Soroban RPC endpoint.
5. Contract events and transaction results are indexed for API and UI consumers.

## Repository map

| Path | Responsibility |
| --- | --- |
| `client/` | React and Vite browser application |
| `server/routes/` | HTTP route definitions |
| `server/services/` | Business logic and Stellar integration |
| `server/models/` | MongoDB persistence models |
| `contracts/` | Soroban contract crates and tests |
| `docs/` | This VitePress documentation site |

## Cross-cutting concerns

The backend centralizes [authentication](./backend-auth.md), [request validation](./api-validation.md), [rate limiting](./rate-limiting.md), [logging](./logging.md), and [health checks](./health-checks.md). Contract-facing features should document their callable interface in the [contract API](./contract-api.md) and emitted data in [contract events](./contract-events.md).

For feature-specific design details, see [streaming payments](./streaming-payments.md), the [vault system](./vault-system.md), [DAO voting](./dao-voting.md), and [multisig](./multisig-integration.md).

