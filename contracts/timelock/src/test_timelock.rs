#![cfg(test)]

use super::*;
use soroban_sdk::{testutils::Address as _, Address, BytesN, Env};

// Import the factory contract WASM for cross-contract testing.
mod factory {
    soroban_sdk::contractimport!(
        file = "../../target/wasm32-unknown-unknown/release/soromint_factory.wasm"
    );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn setup() -> (Env, Address, TimelockContractClient<'static>) {
    let e = Env::default();
    e.mock_all_auths();

    let admin = Address::generate(&e);
    let timelock_id = e.register(TimelockContract, ());
    let client = TimelockContractClient::new(&e, &timelock_id);
    client.initialize(&admin);

    (e, admin, client)
}

fn dummy_wasm_hash(e: &Env, seed: u8) -> BytesN<32> {
    BytesN::from_array(e, &[seed; 32])
}

// ---------------------------------------------------------------------------
// Initialisation
// ---------------------------------------------------------------------------

#[test]
fn test_initialize() {
    let (e, admin, client) = setup();
    assert_eq!(client.get_admin(), admin);
    assert_eq!(client.get_delay(), 48 * 60 * 60);
    let _ = e;
}

#[test]
#[should_panic(expected = "already initialized")]
fn test_initialize_twice_panics() {
    let (_, admin, client) = setup();
    client.initialize(&admin);
}

// ---------------------------------------------------------------------------
// Queue
// ---------------------------------------------------------------------------

#[test]
fn test_queue_operation_returns_id() {
    let (_, _, client) = setup();
    let hash = dummy_wasm_hash(&soroban_sdk::Env::default(), 1);
    let op = FactoryOperation::UpdateWasmHash(hash);
    // Should not panic and should return a 32-byte id
    let _op_id = client.queue_operation(&op);
}

#[test]
#[should_panic(expected = "operation already queued")]
fn test_queue_same_operation_twice_panics() {
    let (e, _, client) = setup();
    let hash = dummy_wasm_hash(&e, 2);
    let op = FactoryOperation::UpdateWasmHash(hash);
    client.queue_operation(&op);
    // Ledger timestamp hasn't changed so eta is identical → same id
    client.queue_operation(&op);
}

// ---------------------------------------------------------------------------
// Cancel
// ---------------------------------------------------------------------------

#[test]
fn test_cancel_operation() {
    let (e, _, client) = setup();
    let hash = dummy_wasm_hash(&e, 3);
    let op = FactoryOperation::UpdateWasmHash(hash.clone());

    let eta = e.ledger().timestamp() + 48 * 60 * 60;
    client.queue_operation(&op);

    // Verify it is queued
    assert!(client.get_operation_eta(&op, &eta).is_some());

    client.cancel_operation(&op, &eta);

    // Verify it is gone
    assert!(client.get_operation_eta(&op, &eta).is_none());
}

#[test]
#[should_panic(expected = "operation not found")]
fn test_cancel_nonexistent_operation_panics() {
    let (e, _, client) = setup();
    let hash = dummy_wasm_hash(&e, 4);
    let op = FactoryOperation::UpdateWasmHash(hash);
    let eta = e.ledger().timestamp() + 48 * 60 * 60;
    client.cancel_operation(&op, &eta);
}

// ---------------------------------------------------------------------------
// Execute — delay enforcement
// ---------------------------------------------------------------------------

#[test]
#[should_panic(expected = "timelock delay not elapsed")]
fn test_execute_before_delay_panics() {
    let (e, _, client) = setup();
    let hash = dummy_wasm_hash(&e, 5);
    let op = FactoryOperation::UpdateWasmHash(hash.clone());

    let eta = e.ledger().timestamp() + 48 * 60 * 60;
    client.queue_operation(&op);

    // Advance time by only 1 hour — still within the lock period
    e.ledger().with_mut(|l| l.timestamp += 3600);

    let dummy_factory = Address::generate(&e);
    client.execute_operation(&dummy_factory, &op, &eta);
}

#[test]
#[should_panic(expected = "operation not found")]
fn test_execute_nonexistent_operation_panics() {
    let (e, _, client) = setup();
    let hash = dummy_wasm_hash(&e, 6);
    let op = FactoryOperation::UpdateWasmHash(hash);
    let eta = e.ledger().timestamp() + 48 * 60 * 60;

    // Advance past the delay without queuing
    e.ledger().with_mut(|l| l.timestamp += 48 * 60 * 60 + 1);

    let dummy_factory = Address::generate(&e);
    client.execute_operation(&dummy_factory, &op, &eta);
}

// ---------------------------------------------------------------------------
// Full end-to-end with real factory WASM
// ---------------------------------------------------------------------------

#[test]
fn test_full_flow_update_wasm_hash() {
    let e = Env::default();
    e.mock_all_auths();

    // Deploy timelock
    let admin = Address::generate(&e);
    let timelock_id = e.register(TimelockContract, ());
    let timelock_client = TimelockContractClient::new(&e, &timelock_id);
    timelock_client.initialize(&admin);

    // Deploy factory with the timelock as its admin
    let factory_id = e.register(factory::TokenFactory, ());
    let factory_client = factory::Client::new(&e, &factory_id);

    // Use a placeholder wasm hash for initialization (no real WASM needed here)
    let initial_hash = BytesN::from_array(&e, &[0u8; 32]);
    factory_client.initialize(&timelock_id, &initial_hash);

    // Queue the update_wasm_hash operation through the timelock
    let new_hash = BytesN::from_array(&e, &[9u8; 32]);
    let op = FactoryOperation::UpdateWasmHash(new_hash.clone());
    let eta = e.ledger().timestamp() + 48 * 60 * 60;

    timelock_client.queue_operation(&op);

    // Confirm it is recorded
    assert!(timelock_client.get_operation_eta(&op, &eta).is_some());

    // Advance ledger past the 48-hour delay
    e.ledger().with_mut(|l| l.timestamp += 48 * 60 * 60 + 1);

    // Execute — the timelock calls factory.update_wasm_hash on our behalf
    timelock_client.execute_operation(&factory_id, &op, &eta);

    // Operation should be cleared after execution
    assert!(timelock_client.get_operation_eta(&op, &eta).is_none());
}

// ---------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------

#[test]
fn test_version_and_status() {
    let (e, _, client) = setup();
    assert_eq!(client.version(), soroban_sdk::String::from_str(&e, "1.0.0"));
    assert_eq!(client.status(), soroban_sdk::String::from_str(&e, "alive"));
}
