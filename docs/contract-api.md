# Contract API Reference

The SoroMint protocol provides standard operational interfaces across its smart contracts to assist with off-chain monitoring, indexing, and developer tooling.

## Operational Endpoints

Both the `SoroMintToken` and `TokenFactory` contracts expose the following read-only functions:

### `version()`
Returns the semantic version of the deployed contract.

- **Signature**: `version(e: Env) -> String`
- **Returns**: A `String` representing the version (e.g., `"0.1.0"` for the token, `"1.0.0"` for the factory).
- **Usage**: Used by off-chain indexers and explorers to determine feature support and ABI compatibility.

### `status()`
Returns the current health or operational status of the contract.

- **Signature**: `status(e: Env) -> String`
- **Returns**: A `String` representing the status (e.g., `"alive"`).
- **Usage**: Used by monitoring dashboards to ensure the contract is responsive and not in a halted or deprecated state.
