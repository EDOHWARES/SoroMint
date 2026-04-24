# Streaming Payments Contract

A Soroban smart contract that enables continuous token payment streams, releasing funds per ledger for real-time payroll and subscription payments.

## Features

- **Per-Ledger Streaming**: Tokens are released continuously based on ledger progression
- **Flexible Duration**: Configure start and stop ledgers for precise payment windows
- **Partial Withdrawals**: Recipients can withdraw available balance at any time
- **Cancellation**: Senders can cancel streams and reclaim unstreamed tokens
- **Multi-Token Support**: Works with any Soroban token contract

## Core Concepts

### Stream Structure
```rust
pub struct Stream {
    pub sender: Address,
    pub recipient: Address,
    pub token: Address,
    pub rate_per_ledger: i128,
    pub start_ledger: u32,
    pub stop_ledger: u32,
    pub withdrawn: i128,
}
```

### Payment Rate Calculation
```
rate_per_ledger = total_amount / (stop_ledger - start_ledger)
streamed_amount = rate_per_ledger × elapsed_ledgers
available_balance = streamed_amount - withdrawn
```

## API Reference

### `create_stream`
Creates a new payment stream.

**Parameters:**
- `sender`: Address funding the stream
- `recipient`: Address receiving the stream
- `token`: Token contract address
- `total_amount`: Total tokens to stream
- `start_ledger`: Ledger when streaming begins
- `stop_ledger`: Ledger when streaming ends

**Returns:** `u64` - Unique stream ID

**Example:**
```rust
let stream_id = client.create_stream(
    &sender,
    &recipient,
    &token_address,
    &100_000_0000000, // 100k tokens with 7 decimals
    &current_ledger,
    &current_ledger + 86400, // ~24 hours at 5s/ledger
);
```

### `withdraw`
Withdraws available balance from a stream.

**Parameters:**
- `stream_id`: Stream identifier
- `amount`: Amount to withdraw

**Authorization:** Requires recipient signature

### `cancel_stream`
Cancels a stream and refunds unstreamed tokens.

**Parameters:**
- `stream_id`: Stream identifier

**Authorization:** Requires sender signature

**Behavior:**
- Transfers available balance to recipient
- Refunds unstreamed tokens to sender
- Removes stream from storage

### `balance_of`
Returns available balance for withdrawal.

**Parameters:**
- `stream_id`: Stream identifier

**Returns:** `i128` - Available token amount

### `get_stream`
Retrieves complete stream details.

**Parameters:**
- `stream_id`: Stream identifier

**Returns:** `Stream` - Full stream data

## Use Cases

### 1. Real-Time Payroll
```rust
// Pay employee 10,000 tokens over 30 days
// Assuming ~5 seconds per ledger: 30 days = 518,400 ledgers
let salary_stream = client.create_stream(
    &company,
    &employee,
    &usdc_token,
    &10_000_0000000,
    &start_ledger,
    &start_ledger + 518_400,
);
```

### 2. Subscription Payments
```rust
// Monthly subscription: 100 tokens over 30 days
let subscription = client.create_stream(
    &subscriber,
    &service_provider,
    &payment_token,
    &100_0000000,
    &current_ledger,
    &current_ledger + 518_400,
);
```

### 3. Vesting Schedule
```rust
// Vest 1M tokens over 1 year
let vesting_stream = client.create_stream(
    &company,
    &founder,
    &company_token,
    &1_000_000_0000000,
    &cliff_ledger,
    &cliff_ledger + 6_307_200, // ~365 days
);
```

## Events

### `created`
Emitted when a stream is created.
```rust
(symbol_short!("created"), stream_id) => (sender, recipient, total_amount)
```

### `withdraw`
Emitted when funds are withdrawn.
```rust
(symbol_short!("withdraw"), stream_id) => (recipient, amount)
```

### `canceled`
Emitted when a stream is canceled.
```rust
(symbol_short!("canceled"), stream_id) => (recipient_balance, refund_amount)
```

## Testing

Run the test suite:
```bash
cd contracts/streaming
cargo test
```

## Build & Deploy

### Build
```bash
cargo build --target wasm32-unknown-unknown --release
```

### Optimize
```bash
soroban contract optimize --wasm target/wasm32-unknown-unknown/release/soromint_streaming.wasm
```

### Deploy
```bash
soroban contract deploy \
  --wasm target/wasm32-unknown-unknown/release/soromint_streaming.wasm \
  --source SENDER_SECRET \
  --rpc-url https://soroban-testnet.stellar.org:443 \
  --network-passphrase "Test SDF Network ; September 2015"
```

## Security Considerations

1. **Authorization**: All sensitive operations require proper authentication
2. **Balance Checks**: Prevents over-withdrawal and ensures sufficient funds
3. **Atomic Operations**: Token transfers and state updates are atomic
4. **Cancellation Safety**: Properly handles refunds and recipient balances

## Limitations

- Minimum stream duration must allow `rate_per_ledger > 0`
- Tokens must be transferred to contract before streaming begins
- No pause/resume functionality (cancel and recreate instead)

## Integration Example

```rust
use soroban_sdk::{Address, Env};

pub fn setup_employee_payment(
    e: &Env,
    streaming_contract: Address,
    token: Address,
    employer: Address,
    employee: Address,
    monthly_salary: i128,
) -> u64 {
    let client = StreamingPaymentsClient::new(e, &streaming_contract);
    let current = e.ledger().sequence();
    let month_in_ledgers = 518_400; // ~30 days
    
    client.create_stream(
        &employer,
        &employee,
        &token,
        &monthly_salary,
        &current,
        &current + month_in_ledgers,
    )
}
```

## License

Part of the SoroMint project.
