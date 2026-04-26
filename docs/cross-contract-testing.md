# Cross-Contract Testing Documentation

## Overview

This document describes the cross-contract integration testing approach for the SoroMint smart contracts. These tests simulate complex interactions between multiple contract instances (factory and token contracts) using Soroban SDK's environment mocking capabilities.

## Testing Architecture

### Environment Mocking

The tests use `soroban_sdk::Env` with `mock_all_auths()` to simulate a complete contract environment without requiring a live network:

```rust
let e = Env::default();
e.mock_all_auths(); // Automatically authorize all transactions
```

### Test Structure

Integration tests are located in `contracts/factory/src/test_integration.rs` and cover:

1. **Cross-contract deployment** - Factory deploying token contracts
2. **State verification** - Ensuring deployed contracts maintain correct state
3. **Event emission** - Verifying events across contract boundaries
4. **Complex workflows** - Multi-step interactions between contracts
5. **Error handling** - Verifying error propagation across contracts

## Test Categories

### 1. Cross-Contract Deployment Tests

Tests that verify the factory can deploy and initialize token contracts correctly.

| Test | Description |
|------|-------------|
| `test_factory_deploys_and_initializes_token` | Verifies complete deployment flow |
| `test_mint_on_factory_deployed_token` | Tests state changes on deployed tokens |
| `test_factory_deploys_multiple_tokens` | Ensures independent token deployments |

### 2. Cross-Contract Event Tests

Tests that verify events are emitted correctly across contract boundaries.

| Test | Description |
|------|-------------|
| `test_cross_contract_events` | Verifies factory deployment events |
| `test_token_events_through_factory_deployment` | Tests token events on factory-deployed contracts |

### 3. Complex Interaction Tests

Tests that simulate real-world usage scenarios.

| Test | Description |
|------|-------------|
| `test_complex_workflow_deploy_mint_transfer_mint` | Full workflow: deploy → mint → transfer ownership → mint |
| `test_burn_on_factory_deployed_token` | Burn functionality on deployed tokens |
| `test_multiple_users_on_factory_token` | Multi-user scenarios |

### 4. Error Handling Tests

Tests that verify errors propagate correctly across contract boundaries.

| Test | Description |
|------|-------------|
| `test_factory_rejects_duplicate_salt` | Ensures deployment uniqueness |
| `test_factory_requires_initialization` | Verifies initialization requirement |
| `test_burn_insufficient_balance_on_factory_token` | Error propagation from token to caller |

### 5. WASM Hash Update Tests

Tests that verify the factory upgrade path.

| Test | Description |
|------|-------------|
| `test_update_wasm_hash_and_deploy` | Tests factory WASM upgrade capability |

### 6. Supply Invariant Tests

Tests that verify supply always equals sum of balances.

| Test | Description |
|------|-------------|
| `test_supply_invariant_across_operations` | Verifies supply invariants hold |

## Running the Tests

### Prerequisites

Ensure you have the Rust toolchain and Soroban CLI installed:

```bash
# Install Rust
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh

# Install Soroban CLI
cargo install --locked soroban-cli
```

### Build WASM

First, build the token contract WASM (required for factory tests):

```bash
cd contracts/token
cargo build --release --target wasm32-unknown-unknown
```

### Run Integration Tests

```bash
# Run all factory tests (including integration)
cd contracts/factory
cargo test

# Run only integration tests
cargo test test_integration

# Run specific test
cargo test test_factory_deploys_and_initializes_token

# Run with output
cargo test -- --nocapture
```

## Test Helpers

### Setup Helper

```rust
fn setup_factory() -> (Env, Address, TokenFactoryClient<'static>)
```

Creates a fresh environment with:
- Mocked authorizations
- Generated admin address
- Registered factory contract

### Event Helpers

```rust
fn last_event_data(e: &Env) -> Val
fn find_event_by_symbol(e: &Env, symbol: Symbol) -> Option<Val>
```

Utilities for extracting and searching events in the environment.

## Key Testing Patterns

### 1. Contract Import Pattern

```rust
mod token {
    soroban_sdk::contractimport!(
        file = "../../target/wasm32-unknown-unknown/release/soromint_token.wasm"
    );
}
```

Imports the token contract WASM for cross-contract testing.

### 2. State Verification Pattern

```rust
let token_client = token::Client::new(&e, &token_address);
assert_eq!(token_client.balance(&user), 1000);
assert_eq!(token_client.supply(), 1000);
```

Verifies state changes on deployed contracts.

### 3. Event Verification Pattern

```rust
let events = e.events().all();
assert!(events.len() > 0);
```

Checks that expected events were emitted.

### 4. Cross-Contract Call Pattern

```rust
let token_address = factory_client.create_token(&salt, &admin, &decimal, &name, &symbol);
let token_client = token::Client::new(&e, &token_address);
token_client.mint(&user, &1000);
```

Deploys via factory, then interacts with the deployed contract.

## Testing Best Practices

1. **Use fresh environments**: Each test should use `setup_factory()` to get a clean state
2. **Mock authorizations**: Always call `e.mock_all_auths()` to avoid auth failures
3. **Verify state at each step**: Check balances, supply, and registry after each operation
4. **Test error cases**: Use `#[should_panic]` to verify error conditions
5. **Use descriptive names**: Test names should clearly describe what they verify

## Common Issues and Solutions

### Issue: WASM file not found

```
error: couldn't read ../../target/wasm32-unknown-unknown/release/soromint_token.wasm
```

**Solution**: Build the token contract first:
```bash
cd contracts/token && cargo build --release --target wasm32-unknown-unknown
```

### Issue: Authorization failures

```
error: authorization failed
```

**Solution**: Ensure `e.mock_all_auths()` is called in setup.

### Issue: Events not found

Events may be optimized away by the SDK in certain conditions (e.g., zero values).

**Solution**: Use `find_event_by_symbol` with `Option` handling or verify state changes directly.

## Coverage Goals

The integration tests aim for:

- **95%+ code coverage** for factory contract
- **Cross-contract path coverage** for all factory → token interactions
- **Event emission verification** for all significant operations
- **Error path coverage** for all error conditions

## Future Enhancements

Potential improvements to the integration test suite:

1. **Gas usage tests** - Measure and assert on gas consumption
2. **Reentrancy tests** - Verify protection against reentrancy attacks
3. **Multi-contract scenarios** - Test interactions with 3+ contracts
4. **Upgrade tests** - Test actual WASM upgrades (not just hash updates)
5. **Fuzzing** - Property-based testing for edge cases
