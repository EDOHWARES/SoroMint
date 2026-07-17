# Deploy smart contracts

This guide targets Stellar testnet. Use a dedicated, minimally funded identity and verify every command before deploying to a public network.

## Install the toolchain

Install Rust, add the WebAssembly target, and install Stellar CLI using the current instructions in the [Stellar developer documentation](https://developers.stellar.org/docs/tools/cli/install-cli).

```bash
rustup target add wasm32v1-none
stellar --version
```

## Configure a testnet identity

```bash
stellar network use testnet
stellar keys generate soromint-deployer --network testnet --fund
stellar keys address soromint-deployer
```

The identity is stored by Stellar CLI. Do not commit secret keys or recovery phrases.

## Test and build

From the repository root, test the workspace before producing deployable artifacts:

```bash
cargo test --workspace
stellar contract build
```

Optimized WASM reduces storage and execution costs:

```bash
stellar contract optimize --wasm target/wasm32v1-none/release/<contract_name>.wasm
```

Replace `<contract_name>` with the artifact emitted by the build. Use the optimized artifact when the command creates one.

## Deploy

```bash
stellar contract deploy \
  --wasm target/wasm32v1-none/release/<contract_name>.wasm \
  --source-account soromint-deployer \
  --network testnet
```

Save the returned contract ID in the appropriate deployment environment, not in source code. Initialize the contract with `stellar contract invoke` using the method and arguments documented in the [contract API](./contract-api.md).

## Verify the deployment

1. Query a read-only contract method with `stellar contract invoke`.
2. Inspect the transaction and contract on [Stellar Expert testnet](https://stellar.expert/explorer/testnet).
3. Update backend configuration with the deployed contract ID.
4. Restart the API and exercise its health check and one end-to-end testnet flow.

Production deployments require an explicit release plan, reviewed administrator addresses, secure signing, and a rollback or upgrade strategy.

