#![cfg(test)]
use super::*;
use proptest::prelude::*;
use soroban_sdk::{
    symbol_short, testutils::Address as _, testutils::Events, Address, Env, IntoVal, String, Val,
    Vec,
};

// ---------------------------------------------------------------------------
// Helper: bootstraps a fresh contract environment with an initialized token.
// ---------------------------------------------------------------------------
fn setup() -> (Env, Address, Address, SoroMintTokenClient<'static>) {
    let e = Env::default();
    e.mock_all_auths();

    let admin = Address::generate(&e);
    let user = Address::generate(&e);
    let token_id = e.register_contract(None, SoroMintToken);
    let client = SoroMintTokenClient::new(&e, &token_id);

    client.initialize(
        &admin,
        &7,
        &String::from_str(&e, "SoroMint"),
        &String::from_str(&e, "SMT"),
    );

    (e, admin, user, client)
}

/// Helper: finds the last event emitted by the contract and returns its data.
fn last_event_data(e: &Env) -> Val {
    let events = e.events().all();
    let last = events.last().expect("expected at least one event");
    last.2
}

// ===========================================================================
// Initialization Tests
// ===========================================================================

#[test]
fn test_initialize_and_mint() {
    let (_, _, user, client) = setup();
    client.mint(&user, &1000);
    assert_eq!(client.balance(&user), 1000);
    assert_eq!(client.decimals(), 7);
    assert_eq!(client.name(), String::from_str(&client.env, "SoroMint"));
    assert_eq!(client.symbol(), String::from_str(&client.env, "SMT"));
}

#[test]
fn test_initialize_emits_event() {
    let e = Env::default();
    e.mock_all_auths();
    let admin = Address::generate(&e);
    let token_id = e.register_contract(None, SoroMintToken);
    let client = SoroMintTokenClient::new(&e, &token_id);

    client.initialize(
        &admin,
        &7,
        &String::from_str(&e, "SoroMint"),
        &String::from_str(&e, "SMT"),
    );

    let data: (Address, u32, String, String) = last_event_data(&e).into_val(&e);
    assert_eq!(data.0, admin);
    assert_eq!(data.1, 7);
    assert_eq!(data.2, String::from_str(&e, "SoroMint"));
    assert_eq!(data.3, String::from_str(&e, "SMT"));
}

// ===========================================================================
// Mint & Burn Tests
// ===========================================================================

#[test]
fn test_mint_and_burn() {
    let (e, _, user, client) = setup();

    client.mint(&user, &1000);
    assert_eq!(client.balance(&user), 1000);
    assert_eq!(client.supply(), 1000);

    client.burn(&user, &400);
    assert_eq!(client.balance(&user), 600);
    assert_eq!(client.supply(), 600);
}

#[test]
#[should_panic(expected = "insufficient balance")]
fn test_burn_insufficient_balance() {
    let (_, _, user, client) = setup();
    client.mint(&user, &100);
    client.burn(&user, &200);
}

// ===========================================================================
// Transfer Tests
// ===========================================================================

#[test]
fn test_transfer() {
    let (e, _, user1, client) = setup();
    let user2 = Address::generate(&e);

    client.mint(&user1, &1000);
    client.transfer(&user1, &user2, &300);

    assert_eq!(client.balance(&user1), 700);
    assert_eq!(client.balance(&user2), 300);
}

#[test]
#[should_panic(expected = "insufficient balance")]
fn test_transfer_insufficient_balance() {
    let (e, _, user1, client) = setup();
    let user2 = Address::generate(&e);

    client.mint(&user1, &100);
    client.transfer(&user1, &user2, &200);
}

#[test]
#[should_panic(expected = "Contract is paused")]
fn test_transfer_fails_when_paused() {
    let (e, _, user1, client) = setup();
    let user2 = Address::generate(&e);

    client.mint(&user1, &1000);
    client.pause();
    
    // This should panic
    client.transfer(&user1, &user2, &300);
}

#[test]
fn test_transfer_succeeds_after_unpause() {
    let (e, _, user1, client) = setup();
    let user2 = Address::generate(&e);

    client.mint(&user1, &1000);
    client.pause();
    client.unpause();
    
    // This should succeed
    client.transfer(&user1, &user2, &300);
    assert_eq!(client.balance(&user1), 700);
}

// ===========================================================================
// Allowance & TransferFrom Tests
// ===========================================================================

#[test]
fn test_approve_and_transfer_from() {
    let (e, _, user1, client) = setup();
    let user2 = Address::generate(&e); // Spender
    let user3 = Address::generate(&e); // Recipient

    client.mint(&user1, &1000);
    client.approve(&user1, &user2, &500, &1000);

    assert_eq!(client.allowance(&user1, &user2), 500);

    client.transfer_from(&user2, &user1, &user3, &200);

    assert_eq!(client.balance(&user1), 800);
    assert_eq!(client.balance(&user3), 200);
    assert_eq!(client.allowance(&user1, &user2), 300);
}

#[test]
#[should_panic(expected = "insufficient allowance")]
fn test_transfer_from_insufficient_allowance() {
    let (e, _, user1, client) = setup();
    let user2 = Address::generate(&e);
    let user3 = Address::generate(&e);

    client.mint(&user1, &1000);
    client.approve(&user1, &user2, &100, &1000);
    client.transfer_from(&user2, &user1, &user3, &200);
}

#[test]
fn test_burn_from() {
    let (e, _, user1, client) = setup();
    let user2 = Address::generate(&e); // Spender

    client.mint(&user1, &1000);
    client.approve(&user1, &user2, &500, &1000);

    client.burn_from(&user2, &user1, &200);

    assert_eq!(client.balance(&user1), 800);
    assert_eq!(client.supply(), 800);
    assert_eq!(client.allowance(&user1, &user2), 300);
}

// ===========================================================================
// Security & Edge Cases
// ===========================================================================

#[test]
#[should_panic(expected = "balance overflow")]
fn test_balance_overflow() {
    let (e, _, user, client) = setup();
    client.mint(&user, &i128::MAX);
    client.mint(&user, &1);
}

#[test]
#[should_panic(expected = "supply overflow")]
fn test_supply_overflow() {
    let (e, _, user1, client) = setup();
    let user2 = Address::generate(&e);
    client.mint(&user1, &i128::MAX);
    client.mint(&user2, &1);
}

#[test]
#[should_panic(expected = "mint amount must be positive")]
fn test_mint_negative() {
    let (_, _, user, client) = setup();
    client.mint(&user, &-1);
}

#[test]
fn test_transfer_ownership() {
    let (e, admin, _, client) = setup();
    let new_admin = Address::generate(&e);

    client.transfer_ownership(&new_admin);

    // After transfer, new_admin should be able to mint
    let user = Address::generate(&e);
    client.mint(&user, &100);
    assert_eq!(client.balance(&user), 100);
}

#[test]
fn test_version_and_status() {
    let (e, _, _, client) = setup();

    assert_eq!(client.version(), String::from_str(&e, "1.0.0"));
    assert_eq!(client.status(), String::from_str(&e, "alive"));
}

// ===========================================================================
// Property-Based Tests
// ===========================================================================

// Feature: contract-versioning-health, Property 1: version idempotence
proptest! {
    #[test]
    fn prop_version_idempotent(_seed: u64) {
        let e = Env::default();
        e.mock_all_auths();
        let admin = Address::generate(&e);
        let token_id = e.register_contract(None, SoroMintToken);
        let client = SoroMintTokenClient::new(&e, &token_id);
        client.initialize(&admin, &7, &String::from_str(&e, "SoroMint"), &String::from_str(&e, "SMT"));
        prop_assert_eq!(client.version(), client.version());
    }
}

// Feature: contract-versioning-health, Property 2: status idempotence
proptest! {
    #[test]
    fn prop_status_idempotent(_seed: u64) {
        let e = Env::default();
        e.mock_all_auths();
        let admin = Address::generate(&e);
        let token_id = e.register_contract(None, SoroMintToken);
        let client = SoroMintTokenClient::new(&e, &token_id);
        client.initialize(&admin, &7, &String::from_str(&e, "SoroMint"), &String::from_str(&e, "SMT"));
        prop_assert_eq!(client.status(), client.status());
    }
}

// Feature: contract-versioning-health, Property 3: version conforms to semver format
proptest! {
    #[test]
    fn prop_version_semver_format(_seed: u64) {
        let e = Env::default();
        e.mock_all_auths();
        let admin = Address::generate(&e);
        let token_id = e.register_contract(None, SoroMintToken);
        let client = SoroMintTokenClient::new(&e, &token_id);
        client.initialize(&admin, &7, &String::from_str(&e, "SoroMint"), &String::from_str(&e, "SMT"));
        prop_assert_eq!(client.version(), String::from_str(&e, "1.0.0"));
    }
}

// Feature: contract-versioning-health, Property 4: status is always "alive"
proptest! {
    #[test]
    fn prop_status_is_alive(_seed: u64) {
        let e = Env::default();
        e.mock_all_auths();
        let admin = Address::generate(&e);
        let token_id = e.register_contract(None, SoroMintToken);
        let client = SoroMintTokenClient::new(&e, &token_id);
        client.initialize(&admin, &7, &String::from_str(&e, "SoroMint"), &String::from_str(&e, "SMT"));
        prop_assert_eq!(client.status(), String::from_str(&e, "alive"));
    }
}

// Feature: contract-versioning-health, Property 5: version and status require no authorization
proptest! {
    #[test]
    fn prop_no_auth_required(_seed: u64) {
        let e = Env::default();
        // Deliberately do NOT call e.mock_all_auths()
        let token_id = e.register_contract(None, SoroMintToken);
        let client = SoroMintTokenClient::new(&e, &token_id);
        // These must not panic even without mock_all_auths
        let _ = client.version();
        let _ = client.status();
    }
}
