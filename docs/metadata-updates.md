# Dynamic Meta-Data Update

## Overview
This feature allows the administrator of the `SoroMintToken` to dynamically update the token's metadata, specifically the `name` and `symbol` after the token has already been deployed and initialized. This does not affect balances or existing transactions.

## Security Assumptions and Validation
- **Admin Only**: The `update_metadata` function strictly validates that the caller is the current token administrator by using `admin.require_auth()`. Only the designated admin can enact metadata changes.
- **Decimals Immutability**: The decimal value is intentionally omitted from the update parameter list and remains fully immutable post-deployment. The initial value is preserved securely in contract storage.
- **Transparency**: A `metadata_updated` event is explicitly emitted with the payload `(admin, old_name, old_symbol, new_name, new_symbol)`. This assures that down-stream indexers and consumers can deterministically track changes to the token identifying information over time.

## Usage
The `update_metadata` function is exported as part of the `SoroMintToken` interface.

```rust
    /// Updates the name and symbol of the token.
    ///
    /// # Arguments
    /// * `new_name`   - The new human-readable token name.
    /// * `new_symbol` - The new token ticker symbol.
    ///
    /// # Authorization
    /// Requires the current admin to authorize the transaction.
    ///
    /// # Events
    /// Emits a `metadata_updated` event with `(admin, old_name, old_symbol, new_name, new_symbol)`.
    pub fn update_metadata(e: Env, new_name: String, new_symbol: String) {
        ...
    }
```

The updated metadata parameters can be retrieved at any time by invoking the newly exposed read-only methods `name()`, `symbol()`, and `decimals()`.
