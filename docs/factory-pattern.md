# Token Factory Pattern in SoroMint

The **Token Factory** is a specialized contract that provides a streamlined, one-click mechanism for deploying and initializing new SEP-41 compliant tokens. This pattern ensures consistency, transparency, and ease of use for developers and users wishing to launch their own assets on the Soroban network.

## Features

- **Predictable Deployment**: Uses Soroban's predictable contract addresses through salt-based deployment.
- **Atomic Creation**: Deploys AND initializes a new token contract in a single transaction.
- **Registry**: Maintains a verifiable on-chain registry of all tokens deployed by the factory.
- **Dynamic Updates**: Allows the factory administrator to update the token WASM hash used for future deployments.
- **Factory Fee Sharing**: Optionally charges a configurable creation fee and forwards it to a treasury wallet before deployment completes.

## Contract Interface

### `initialize(admin: Address, wasm_hash: BytesN<32>)`
Sets up the factory with an administrator and the initial token contract WASM hash.

### `create_token(salt: BytesN<32>, admin: Address, decimal: u32, name: String, symbol: String) -> Address`
Deploys a new token contract. 
1. Generates a new address using the factory's address and the provided `salt`.
2. If configured, transfers the factory creation fee from the payer to the treasury.
3. Deploys the stored WASM hash to that address.
4. Invokes the `initialize` function on the new contract with the provided parameters.
5. Adds the new address to the registry.
6. Emits a `contract_deployed` event.

### `get_tokens() -> Vec<Address>`
Returns the entire list of token addresses deployed via this factory.

### `update_wasm_hash(new_wasm_hash: BytesN<32>)`
Updates the template WASM hash for all future token deployments.

### `set_treasury(treasury: Address)`
Updates the address that receives collected factory fees.

### `set_creation_fee(creation_fee: i128)`
Sets the flat fee charged for each `create_token*` deployment path. A value of `0` disables fee collection.

### `set_fee_token(fee_token: Address)`
Sets the token contract used to collect the creation fee. The fee token must support standard Soroban token transfers.

### `get_treasury() -> Address`, `get_creation_fee() -> i128`, `get_fee_token() -> Option<Address>`
Read helpers for the currently configured fee-sharing module.

## Security Considerations

1. **Authorized Updates**: Only the factory administrator can change the WASM hash or fee-sharing settings.
2. **Fail-Closed Fee Collection**: If a non-zero creation fee is configured without a fee token or enough payer balance, deployment aborts before the token is created.
3. **Predictable Defaults**: The factory enforces the `initialize` signature on deployed tokens, ensuring they are set up correctly before they can be used.
4. **Auditability**: The registry provides a source of truth for all "official" tokens spawned by the platform.

## Usage Example (JavaScript)

```javascript
const factory = new TokenFactoryClient(env, factoryId);

// Deploy a new token named "Glimmer" (GLMR)
const salt = Buffer.alloc(32, 1);
const admin = userAddress;
const tokenAddress = await factory.create_token({
  salt,
  admin,
  decimal: 7,
  name: "Glimmer",
  symbol: "GLMR"
});

console.log("Deployed Glimmer at:", tokenAddress);
```
