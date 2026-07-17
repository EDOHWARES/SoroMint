# Smart contracts

SoroMint contracts live as Rust crates under `contracts/`. Each crate contains its public contract implementation and, where applicable, unit tests and supporting storage or event modules.

## Core guides

- [Contract API](./contract-api.md) documents callable interfaces.
- [Contract events](./contract-events.md) documents event topics and payloads.
- [Token design](./token-design.md) covers token behavior and controls.
- [Vault system](./vault-system.md) covers collateral, debt, pricing, and liquidation.
- [Streaming payments](./streaming-payments.md) covers time-based token distribution.
- [DAO voting](./dao-voting.md) and [multisig](./multisig-integration.md) cover governance.
- [Factory pattern](./factory-pattern.md), [lifecycle](./lifecycle.md), and [ownership](./ownership-model.md) describe reusable contract patterns.

Use the [deployment guide](./contract-deployment.md) to build, test, optimize, and deploy a contract to Stellar testnet.

