#![cfg(test)]
use super::*;
use soroban_sdk::{testutils::Address as _, Address, Env, String};

fn setup() -> (Env, Address, SoroMintTokenClient<'static>) {
    let e = Env::default();
    e.mock_all_auths();
    let admin = Address::generate(&e);
    let token_id = e.register_contract(None, SoroMintToken);
    let client = SoroMintTokenClient::new(&e, &token_id);
    client.initialize(&admin, &7, &String::from_str(&e, "SoroMint"), &String::from_str(&e, "SMT"));
    (e, admin, client)
}

#[test]
fn test_initialize_and_mint() {
    let (e, _admin, client) = setup();
    let user = Address::generate(&e);
    client.mint(&user, &1000);
    assert_eq!(client.balance(&user), 1000);
}

#[test]
fn test_total_supply_zero_after_initialize() {
    let (_e, _admin, client) = setup();
    assert_eq!(client.total_supply(), 0);
}

#[test]
fn test_total_supply_increases_on_mint() {
    let (e, _admin, client) = setup();
    let user = Address::generate(&e);
    client.mint(&user, &500);
    assert_eq!(client.total_supply(), 500);
    client.mint(&user, &300);
    assert_eq!(client.total_supply(), 800);
}

#[test]
fn test_total_supply_decreases_on_burn() {
    let (e, _admin, client) = setup();
    let user = Address::generate(&e);
    client.mint(&user, &1000);
    client.burn(&user, &400);
    assert_eq!(client.total_supply(), 600);
    assert_eq!(client.balance(&user), 600);
}

#[test]
fn test_supply_equals_sum_of_balances() {
    let (e, _admin, client) = setup();
    let user1 = Address::generate(&e);
    let user2 = Address::generate(&e);
    client.mint(&user1, &700);
    client.mint(&user2, &300);
    client.burn(&user1, &200);
    let sum = client.balance(&user1) + client.balance(&user2);
    assert_eq!(client.total_supply(), sum);
}

// The Soroban host wraps contract panics in a HostError envelope.
// The balance overflows first (i128::MAX + 1), which the host surfaces as WasmVm/InvalidAction.
// We match on the inner panic message fragment visible in the host error log.
#[test]
#[should_panic(expected = "balance overflow")]
fn test_mint_overflow() {
    let (e, _admin, client) = setup();
    let user = Address::generate(&e);
    client.mint(&user, &i128::MAX);
    client.mint(&user, &1);
}

#[test]
#[should_panic(expected = "insufficient balance")]
fn test_burn_exceeds_balance() {
    let (e, _admin, client) = setup();
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
    let (e, _admin, client) = setup();
    let user = Address::generate(&e);
    client.mint(&user, &100);
    client.burn(&user, &200);
}

#[test]
#[should_panic(expected = "mint amount must be positive")]
fn test_mint_zero_panics() {
    let (e, _admin, client) = setup();
    let user = Address::generate(&e);
    client.mint(&user, &0);
}

#[test]
#[should_panic(expected = "burn amount must be positive")]
fn test_burn_zero_panics() {
    let (e, _admin, client) = setup();
    let user = Address::generate(&e);
    client.mint(&user, &100);
    client.burn(&user, &0);
}
