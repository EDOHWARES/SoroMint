# Streaming Payments Contract

A Soroban smart contract for funded token streams. It supports both classic linear per-ledger releases and milestone schedules that unlock discrete tranches at specific ledgers.

## Features

- Linear per-ledger streaming for payroll, subscriptions, and recurring payments
- Milestone schedules for cliffs and tiered vesting releases
- Partial withdrawals against currently available balance
- Sender cancellation with recipient payout of vested funds and refund of unreleased funds
- Multi-token support through Soroban token contracts

## Core Types

### `Stream`

`Stream` remains the primary metadata record returned by `get_stream`:

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

For milestone streams:

- `start_ledger` is the first milestone ledger
- `stop_ledger` is the last milestone ledger
- `rate_per_ledger` is `0` because balances do not accrue linearly

### `Milestone`

```rust
pub struct Milestone {
    pub ledger: u32,
    pub amount: i128,
}
```

Each milestone releases `amount` when the current ledger sequence is greater than or equal to `ledger`.

### `Schedule`

```rust
pub enum Schedule {
    Linear(i128),
    Milestone(Vec<Milestone>),
}
```

Use `get_schedule` to inspect whether a stream is linear or milestone-based. `get_milestones` returns the milestone list for milestone streams and an empty vector for linear streams.

## Release Semantics

### Linear streams

```text
rate_per_ledger = total_amount / (stop_ledger - start_ledger)
streamed_amount = rate_per_ledger × elapsed_ledgers
available_balance = streamed_amount - withdrawn
```

Linear streaming behavior is unchanged from the original API.

### Milestone streams

```text
streamed_amount = sum(m.amount for m if current_ledger >= m.ledger)
available_balance = streamed_amount - withdrawn
```

This allows:

- cliff schedules where nothing is withdrawable until a specific ledger
- tiered schedules where the available balance jumps at each milestone ledger
- non-linear vesting without replacing the separate vesting contract

At the exact milestone ledger, that milestone amount becomes withdrawable immediately.

## API Reference

### `create_stream`

Creates a linear stream.

```rust
create_stream(sender, recipient, token, total_amount, start_ledger, stop_ledger) -> u64
```

Use this for payroll, subscriptions, and any flow that should accrue per ledger.

### `create_milestone_stream`

Creates a milestone-based stream.

```rust
create_milestone_stream(sender, recipient, token, milestones) -> u64
```

Validation rules:

- `milestones` must be non-empty
- each milestone `amount` must be positive
- milestone ledgers must be strictly increasing
- total funded amount must be positive

The contract transfers the sum of all milestone amounts from `sender` into escrow at creation time.

### `balance_of`

Returns the currently withdrawable amount.

- linear stream: accrued per ledger minus prior withdrawals
- milestone stream: sum of milestones whose `ledger <= current_ledger`, minus prior withdrawals

### `withdraw`

Withdraws any available amount from a stream. Recipient authorization is required.

### `cancel_stream`

Cancels an existing stream. Sender authorization is required.

Cancellation semantics:

- recipient receives any vested but not yet withdrawn balance
- sender receives unreleased or unstreamed balance
- already withdrawn amounts are not paid twice
- the stream and schedule are removed from storage

### `get_stream`

Returns the base stream record for both linear and milestone streams.

### `get_schedule`

Returns the full schedule descriptor:

- `Schedule::Linear(total_amount)`
- `Schedule::Milestone(milestones)`

### `get_milestones`

Returns the stored milestone list for milestone streams. Linear streams return an empty vector.

## Examples

### Linear payroll stream

```rust
let stream_id = client.create_stream(
    &employer,
    &employee,
    &usdc_token,
    &10_000_0000000,
    &start_ledger,
    &start_ledger + 518_400,
);
```

### Cliff vesting with a single release

```rust
let milestones = vec![
    Milestone {
        ledger: cliff_ledger,
        amount: 1_000_000_0000000,
    },
];

let stream_id = client.create_milestone_stream(
    &company,
    &beneficiary,
    &token,
    &milestones,
);
```

Before `cliff_ledger`, `balance_of(stream_id) == 0`. At `cliff_ledger`, the full amount becomes available.

### Tiered vesting schedule

```rust
let milestones = vec![
    Milestone {
        ledger: tge_ledger,
        amount: 100_000_0000000,
    },
    Milestone {
        ledger: tge_ledger + 100_000,
        amount: 200_000_0000000,
    },
    Milestone {
        ledger: tge_ledger + 200_000,
        amount: 700_000_0000000,
    },
];

let stream_id = client.create_milestone_stream(
    &company,
    &investor,
    &token,
    &milestones,
);
```

`balance_of` jumps by each milestone amount when the corresponding ledger is reached.

## Events

### `created`

Emitted when a stream is created.

```rust
(symbol_short!("created"), stream_id) => (sender, recipient, total_amount)
```

Both linear and milestone streams emit `created`.

### `msched`

Emitted for milestone stream creation.

```rust
(symbol_short!("msched"), stream_id) => (start_ledger, stop_ledger, total_amount)
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

```bash
cargo test -p soromint-streaming
```

## Build

```bash
cargo build -p soromint-streaming --target wasm32-unknown-unknown --release
```

## Notes

- `create_stream` remains the preferred interface for continuous per-ledger payments
- `create_milestone_stream` is intended for cliffs and tiered jump-ahead releases
- milestone schedules are ledger-based and do not require an admin release transaction
