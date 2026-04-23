# SoroMint Vault Contract

Multi-collateral vault system for minting stable SMT tokens.

## Features

- Multi-token collateral support
- Configurable collateralization ratios per token
- Automated liquidation mechanism
- Oracle-based price feeds
- Proportional collateral seizure

## Build

```bash
cargo build --target wasm32-unknown-unknown --release
```

## Test

```bash
cargo test
```

## Deploy

```bash
soroban contract deploy \
  --wasm target/wasm32-unknown-unknown/release/soromint_vault.wasm \
  --network testnet
```

## Initialize

```bash
soroban contract invoke \
  --id <CONTRACT_ID> \
  --network testnet \
  -- initialize \
  --admin <ADMIN_ADDRESS> \
  --smt-token <SMT_TOKEN_ADDRESS> \
  --oracle <ORACLE_ADDRESS>
```

## Documentation

See `docs/vault-system.md` for complete documentation.
