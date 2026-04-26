# Configurable Transfer Tax (Fee-on-Transfer)

SoroMint implements an optional, admin-configurable fee-on-transfer mechanism. This allows the contract owner to capture a percentage of every token transfer and redirect it to a dedicated treasury address.

## Features

- **Admin Configurable**: The tax can be enabled or disabled at any time by the contract admin.
- **Adjustable Rate**: The fee percentage is specified in basis points (bps), where 100 bps = 1%.
- **Hard Cap**: The fee is hard-capped at **10% (1000 bps)** to prevent administrative abuse and ensure token utility.
- **Treasury Redirection**: Collected fees are automatically transferred to a specified treasury address during the transfer operation.
- **Observability**: Every fee collection triggers a `fee_collected` event for off-chain tracking.

## Configuration

The admin can update the fee configuration using the `set_fee_config` function:

```rust
pub fn set_fee_config(e: Env, enabled: bool, fee_bps: u32, treasury: Address)
```

### Parameters

- `enabled`: Boolean to turn the tax on or off.
- `fee_bps`: The fee amount in basis points (max 1000).
- `treasury`: The address that will receive the collected fees.

## Implementation Details

The fee calculation is integrated into the `move_balance` internal function, which is used by both `transfer` and `transfer_from`.

### Calculation Routine
```rust
let fee_amount = amount.checked_mul(fee_bps).unwrap().checked_div(10000).unwrap();
```

- **Rounding**: The calculation uses floor division. Small transfers where the fee would be less than 1 token unit (based on the bps rate) result in 0 fee.
- **Atomic Operations**: The fee collection and the main transfer are processed in a single atomic transaction.

## Security Considerations

1. **Upper Cap**: The 10% cap is enforced at the contract level in `set_fee_config`.
2. **Authorization**: Only the registered `Admin` can update the fee configuration (`admin.require_auth()`).
3. **Transparency**: All configuration changes and fee collections are emitted as events.
