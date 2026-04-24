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

## Metadata Management

The token supports a link to external rich metadata stored on decentralized storage platforms.

### `set_metadata_resolver()`
Sets the address of the resolver contract that provides the external metadata hash. Requires admin authorization.

- **Signature**: `set_metadata_resolver(e: Env, resolver: Address)`
- **Returns**: `()` (void)
- **Events**: Emits a `metadata_updated` event.

### `metadata_hash()`
Returns the current metadata hash by querying the configured resolver (or local storage as fallback).

- **Signature**: `metadata_hash(e: Env) -> Option<String>`
- **Returns**: `Option<String>` containing the hash or `None`.
