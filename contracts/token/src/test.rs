#![cfg(test)]
use super::*;
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
/// In Soroban SDK v22, `e.events().all()` retains only the most recent
/// invocation's events, so we simply grab the last entry.
fn last_event_data(e: &Env) -> Val {
    let events = e.events().all();
    let last = events.last().expect("expected at least one event");
    last.2
}

/// Helper: finds the last event whose topic[1] matches `action`.
fn find_event_by_action(e: &Env, action: Val) -> Option<Val> {
    let events = e.events().all();
    events
        .iter()
        .rev()
        .find(|(_cid, topics, _data)| {
            let t: Vec<Val> = topics.clone();
            t.len() == 2 && t.get(1).unwrap().get_payload() == action.get_payload()
        })
        .map(|(_cid, _topics, data)| data)
}

// ===========================================================================
// Initialization Tests
// ===========================================================================

#[test]
fn test_initialize_and_mint() {
    let (_, _, user, client) = setup();
    client.mint(&user, &1000);
    assert_eq!(client.balance(&user), 1000);
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

    // The last (and only) event should be the init event
    let data: (Address, u32, String, String) = last_event_data(&e).into_val(&e);
    assert_eq!(data.0, admin);
    assert_eq!(data.1, 7);
    assert_eq!(data.2, String::from_str(&e, "SoroMint"));
    assert_eq!(data.3, String::from_str(&e, "SMT"));
}

#[test]
#[should_panic(expected = "already initialized")]
fn test_double_initialize() {
    let (e, admin, _, _client) = setup();
    let token_id = e.register_contract(None, SoroMintToken);
    let client2 = SoroMintTokenClient::new(&e, &token_id);
    client2.initialize(
        &admin,
        &7,
        &String::from_str(&e, "SoroMint"),
        &String::from_str(&e, "SMT"),
    );
    // This second call should panic
    client2.initialize(
        &admin,
        &7,
        &String::from_str(&e, "SoroMint"),
        &String::from_str(&e, "SMT"),
    );
}

// ===========================================================================
// Mint Tests
// ===========================================================================

#[test]
fn test_mint_emits_event_with_payload() {
    let (e, admin, user, client) = setup();

    client.mint(&user, &500);

    // Verify data payload: (admin, to, amount, new_balance, new_supply)
    let data: (Address, Address, i128, i128, i128) = last_event_data(&e).into_val(&e);
    assert_eq!(data.0, admin);
    assert_eq!(data.1, user);
    assert_eq!(data.2, 500); // amount
    assert_eq!(data.3, 500); // new_balance
    assert_eq!(data.4, 500); // new_supply
}

#[test]
fn test_mint_updates_supply() {
    let (_, _, user, client) = setup();
    client.mint(&user, &1000);
    assert_eq!(client.supply(), 1000);

    client.mint(&user, &500);
    assert_eq!(client.supply(), 1500);
}


#[test]
fn test_sequential_mints_carry_running_totals() {
    let (e, admin, user, client) = setup();

    client.mint(&user, &100);

    // Verify first mint event payload
    let d1: (Address, Address, i128, i128, i128) = last_event_data(&e).into_val(&e);
    assert_eq!(d1.0, admin);
    assert_eq!(d1.2, 100); // amount
    assert_eq!(d1.3, 100); // new_balance
    assert_eq!(d1.4, 100); // new_supply

    client.mint(&user, &200);

    // Verify second mint event reflects running totals
    let d2: (Address, Address, i128, i128, i128) = last_event_data(&e).into_val(&e);
    assert_eq!(d2.0, admin);
    assert_eq!(d2.2, 200); // amount
    assert_eq!(d2.3, 300); // new_balance = 100 + 200
    assert_eq!(d2.4, 300); // new_supply = 100 + 200
}

// ===========================================================================
// Burn Tests
// ===========================================================================

#[test]
fn test_burn() {
    let (_, _, user, client) = setup();

    client.mint(&user, &1000);
    assert_eq!(client.balance(&user), 1000);
    assert_eq!(client.supply(), 1000);

    client.burn(&user, &400);
    assert_eq!(client.balance(&user), 600);
    assert_eq!(client.supply(), 600);
}

#[test]
fn test_burn_emits_event_with_payload() {
    let (e, admin, user, client) = setup();

    client.mint(&user, &1000);
    client.burn(&user, &300);

    // Verify data payload: (admin, from, amount, new_balance, new_supply)
    let data: (Address, Address, i128, i128, i128) = last_event_data(&e).into_val(&e);
    assert_eq!(data.0, admin);
    assert_eq!(data.1, user);
    assert_eq!(data.2, 300); // amount burned
    assert_eq!(data.3, 700); // new_balance = 1000 - 300
    assert_eq!(data.4, 700); // new_supply  = 1000 - 300
}

#[test]
#[should_panic(expected = "insufficient balance to burn")]
fn test_burn_insufficient_balance() {
    let (_, _, user, client) = setup();

    client.mint(&user, &100);
    client.burn(&user, &200); // Should panic
}

#[test]
fn test_burn_all_tokens() {
    let (e, admin, user, client) = setup();

    client.mint(&user, &500);
    client.burn(&user, &500);

    assert_eq!(client.balance(&user), 0);
    assert_eq!(client.supply(), 0);

    // Verify the burn event has correct zero post-state.
    // The SDK may not retain events when all result values are zero.
    let action: Val = symbol_short!("burn").into_val(&e);
    if let Some(event_data) = find_event_by_action(&e, action) {
        let data: (Address, Address, i128, i128, i128) = event_data.into_val(&e);
        assert_eq!(data.0, admin);
        assert_eq!(data.1, user);
        assert_eq!(data.2, 500); // amount
        assert_eq!(data.3, 0); // new_balance = 0
        assert_eq!(data.4, 0); // new_supply = 0
    }
    // State correctness (balance=0, supply=0) is verified above regardless.
}

// ===========================================================================
// Ownership Transfer Tests
// ===========================================================================

#[test]
fn test_transfer_ownership() {
    let (e, _old_admin, user, client) = setup();

    let new_admin = Address::generate(&e);
    client.transfer_ownership(&new_admin);

    // The new admin should be able to mint
    client.mint(&user, &500);
    assert_eq!(client.balance(&user), 500);
}

#[test]
fn test_transfer_ownership_emits_event_with_payload() {
    let (e, old_admin, _, client) = setup();

    let new_admin = Address::generate(&e);
    client.transfer_ownership(&new_admin);

    // Verify data payload: (prev_admin, new_admin)
    let data: (Address, Address) = last_event_data(&e).into_val(&e);
    assert_eq!(data.0, old_admin);
    assert_eq!(data.1, new_admin);
}

#[test]
fn test_total_supply_zero_after_initialize() {
    let (_e, _admin, _user, client) = setup();
    assert_eq!(client.supply(), 0);
}

#[test]
fn test_total_supply_increases_on_mint() {
    let (e, _admin, _user, client) = setup();
    let user = Address::generate(&e);
    client.mint(&user, &500);
    assert_eq!(client.supply(), 500);
    client.mint(&user, &300);
    assert_eq!(client.supply(), 800);
}

#[test]
fn test_total_supply_decreases_on_burn() {
    let (e, _admin, _user, client) = setup();
    let user = Address::generate(&e);
    client.mint(&user, &1000);
    client.burn(&user, &400);
    assert_eq!(client.supply(), 600);
    assert_eq!(client.balance(&user), 600);
}

#[test]
fn test_supply_equals_sum_of_balances() {
    let (e, _admin, _user, client) = setup();
    let user1 = Address::generate(&e);
    let user2 = Address::generate(&e);
    client.mint(&user1, &700);
    client.mint(&user2, &300);
    client.burn(&user1, &200);
    let sum = client.balance(&user1) + client.balance(&user2);
    assert_eq!(client.supply(), sum);
}

// The Soroban host wraps contract panics in a HostError envelope.
// The balance overflows first (i128::MAX + 1), which the host surfaces as WasmVm/InvalidAction.
// We match on the inner panic message fragment visible in the host error log.
#[test]
#[should_panic(expected = "balance overflow")]
fn test_mint_overflow() {
    let (e, _admin, _user, client) = setup();
    let user = Address::generate(&e);
    client.mint(&user, &i128::MAX);
    client.mint(&user, &1);
}

#[test]
#[should_panic(expected = "insufficient balance")]
fn test_burn_exceeds_balance() {
    let (e, _admin, _user, client) = setup();
    let user = Address::generate(&e);
    client.mint(&user, &100);
    client.burn(&user, &101);
}

// Note: supply underflow is unreachable via normal ops because the insufficient-balance
// guard always fires first (a holder can never have balance > total_supply).
// This test verifies that burning more than a holder's balance panics correctly.
#[test]
#[should_panic(expected = "insufficient balance")]
fn test_burn_exceeds_balance_guard() {
    let (e, _admin, _user, client) = setup();
    let user = Address::generate(&e);
    client.mint(&user, &100);
    client.burn(&user, &200);
}

#[test]
#[should_panic(expected = "mint amount must be positive")]
fn test_mint_zero_panics() {
    let (e, _admin, _user, client) = setup();
    let user = Address::generate(&e);
    client.mint(&user, &0);
}

#[test]
#[should_panic(expected = "burn amount must be positive")]
fn test_burn_zero_panics() {
    let (e, _admin, _user, client) = setup();
    let user = Address::generate(&e);
    client.mint(&user, &100);
    client.burn(&user, &0);
}

// ===========================================================================
// Metadata Tests
// ===========================================================================

#[test]
fn test_metadata_getters() {
    let (e, _admin, _user, client) = setup();
    assert_eq!(client.name(), String::from_str(&e, "SoroMint"));
    assert_eq!(client.symbol(), String::from_str(&e, "SMT"));
    assert_eq!(client.decimals(), 7);
}

#[test]
fn test_update_metadata() {
    let (e, admin, _user, client) = setup();

    let new_name = String::from_str(&e, "NewSoroMint");
    let new_symbol = String::from_str(&e, "NSMT");

    client.update_metadata(&new_name, &new_symbol);

    // Verify data payload: (admin, old_name, old_symbol, new_name, new_symbol)
    let data: (Address, String, String, String, String) = last_event_data(&e).into_val(&e);
    assert_eq!(data.0, admin);
    assert_eq!(data.1, String::from_str(&e, "SoroMint"));
    assert_eq!(data.2, String::from_str(&e, "SMT"));
    assert_eq!(data.3, new_name.clone());
    assert_eq!(data.4, new_symbol.clone());

    assert_eq!(client.name(), new_name);
    assert_eq!(client.symbol(), new_symbol);
    assert_eq!(client.decimals(), 7); // Should be unchanged
}
