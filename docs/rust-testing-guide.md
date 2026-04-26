# Rust Testing Guide

This guide documents the contract unit-testing strategy used for SoroMint's
current token implementation.

## Scope

The token contract currently exposes these core state-transition paths:

- `initialize`
- `transfer`
- `approve`
- `allowance`
- `transfer_from`
- `mint`
- `burn`
- `balance`
- `supply`
- `transfer_ownership`

## Testing approach

The tests use `soroban_sdk::Env` and run entirely in Rust unit tests so they are
fast, deterministic, and easy to review.

Each test starts from a fresh environment and an initialized token contract.
This keeps state isolated and makes failures easier to debug.

## Invariants covered

- Initialization is one-time only.
- Total supply starts at zero.
- Minting increases both recipient balance and total supply.
- Direct transfers preserve total supply while moving balances.
- Allowances can be created, overwritten, consumed, and exhausted exactly.
- Delegated transfers decrement allowance and keep total supply stable.
- Sequential mints preserve running totals.
- Balances remain isolated across multiple accounts.
- Burning decreases both holder balance and total supply.
- Total supply always matches the sum of tracked balances after mixed flows.
- Ownership transfer emits the expected event and updates the admin used by
  later writes.

## Edge cases covered

- Minting zero panics.
- Minting a negative amount panics.
- Mint overflow panics.
- Transferring zero panics.
- Transferring more than the available balance panics.
- Negative allowances panic.
- Delegated transfers above allowance panic.
- Delegated transfers above owner balance panic.
- Burning zero panics.
- Burning a negative amount panics.
- Burning more than the available balance panics.

## Why these tests matter

The most important risks in a token contract are silent state drift and invalid
state transitions. The suite is designed to catch both:

- Supply and balances must move together.
- Allowance consumption must match delegated transfers exactly.
- Transfers to self must not drift balances or supply.
- Invalid burn inputs must not create value accidentally.
- Ownership changes must affect later privileged operations.

## Running the tests

From the repository root:

```bash
cargo test
```

To focus on the token contract only:

```bash
cargo test -p soromint-token
```
