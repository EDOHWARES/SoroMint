# AMM Factory and Pool Contracts

The SoroMint AMM layer introduces a dedicated factory and pool pair for launching liquidity markets around SoroMint-issued tokens.

## Contracts

### `AmmFactory`

Deploys and indexes liquidity pools for SoroMint tokens paired with one of two configured quote assets:

- wrapped XLM token contract
- wrapped USDC token contract

Core behavior:

- validates that the base asset was deployed through the existing `TokenFactory`
- rejects unsupported quote assets
- rejects duplicate `(minted_token, quote_token)` pairs
- deploys a new `AmmPool` and initializes it with the configured default fee
- stores pair-to-pool and full pool registry lookups

Main methods:

- `initialize(admin, pool_wasm_hash, token_factory, xlm_token, usdc_token, fee_bps)`
- `create_pool(salt, minted_token, quote_token) -> Address`
- `get_pool(minted_token, quote_token) -> Option<Address>`
- `get_pools() -> Vec<Address>`
- `is_supported_quote_token(quote_token) -> bool`
- `is_minted_token(token) -> bool`
- `update_pool_wasm_hash(new_pool_wasm_hash)`
- `update_fee_bps(new_fee_bps)`

### `AmmPool`

Implements a constant-product market maker between a SoroMint token and its quote asset.

Core behavior:

- tracks token and quote reserves
- mints internal LP shares on deposit
- burns LP shares on withdrawal
- executes `x * y = k` swaps with basis-point fees
- exposes read-only helpers for reserves, pool configuration, liquidity quotes, and swap quotes

Main methods:

- `initialize(factory, token, quote_token, fee_bps)`
- `config() -> PoolConfig`
- `reserves() -> PoolReserves`
- `quote_add_liquidity(max_token_amount, max_quote_amount) -> LiquidityPosition`
- `add_liquidity(provider, max_token_amount, max_quote_amount, min_shares) -> LiquidityPosition`
- `remove_liquidity(provider, shares, min_token_amount, min_quote_amount) -> LiquidityPosition`
- `quote_swap(input_token, amount_in) -> SwapQuote`
- `swap(trader, input_token, amount_in, min_amount_out) -> SwapResult`
- `share_balance(provider) -> i128`
- `total_shares() -> i128`

## Operational Notes

- XLM and USDC are modeled as token contract addresses, not hard-coded native asset branches.
- Pool deployment uses the Soroban deployer path in production code.
- In tests, the AMM factory uses deterministic local registration for pool deployment so the contract logic can be exercised without depending on toolchain-sensitive WASM deployment inside the test host.
