#![cfg(test)]

use super::*;
use soroban_sdk::{testutils::Address as _, Address, Env, String, TryFromVal};
use soroban_sdk::testutils::Ledger as _;

fn setup() -> (Env, Address, Address, SoroMintTokenClient<'static>) {
    let e = Env::default();
    e.mock_all_auths();
    let admin = Address::generate(&e);
    let minter = Address::generate(&e);
    let token_id = e.register(SoroMintToken, ());
    let client = SoroMintTokenClient::new(&e, &token_id);
    client.initialize(&admin, &7, &String::from_str(&e, "SoroMint"), &String::from_str(&e, "SMT"));
    (e, admin, minter, client)
}

#[test]
fn test_set_and_get_minter_limit() {
    let (_, _, minter, client) = setup();
    client.set_minter_limit(&minter, &1000);
    assert_eq!(client.minter_limit(&minter), Some(1000));
}

#[test]
fn test_minter_mint_within_limit() {
    let (e, _, minter, client) = setup();
    let recipient = Address::generate(&e);
    client.set_minter_limit(&minter, &1000);
    client.minter_mint(&minter, &recipient, &500);
    assert_eq!(client.balance(&recipient), 500);
    assert_eq!(client.supply(), 500);
}

#[test]
fn test_minter_mint_accumulates_within_window() {
    let (e, _, minter, client) = setup();
    let recipient = Address::generate(&e);
    client.set_minter_limit(&minter, &1000);
    client.minter_mint(&minter, &recipient, &400);
    client.minter_mint(&minter, &recipient, &400);
    assert_eq!(client.balance(&recipient), 800);
}

#[test]
#[should_panic(expected = "minting limit exceeded for period")]
fn test_minter_mint_exceeds_limit_panics() {
    let (e, _, minter, client) = setup();
    let recipient = Address::generate(&e);
    client.set_minter_limit(&minter, &500);
    client.minter_mint(&minter, &recipient, &300);
    client.minter_mint(&minter, &recipient, &300); // total 600 > 500
}

#[test]
#[should_panic(expected = "no mint limit configured for minter")]
fn test_minter_mint_without_limit_panics() {
    let (e, _, minter, client) = setup();
    let recipient = Address::generate(&e);
    client.minter_mint(&minter, &recipient, &100);
}

#[test]
#[should_panic(expected = "mint amount must be positive")]
fn test_minter_mint_zero_panics() {
    let (e, _, minter, client) = setup();
    let recipient = Address::generate(&e);
    client.set_minter_limit(&minter, &1000);
    client.minter_mint(&minter, &recipient, &0);
}

#[test]
#[should_panic(expected = "limit must be positive")]
fn test_set_minter_limit_zero_panics() {
    let (_, _, minter, client) = setup();
    client.set_minter_limit(&minter, &0);
}

#[test]
fn test_minter_limit_resets_after_24h() {
    let (e, _, minter, client) = setup();
    let recipient = Address::generate(&e);
    client.set_minter_limit(&minter, &500);
    client.minter_mint(&minter, &recipient, &500);

    // Advance ledger time by 24h + 1 second
    e.ledger().with_mut(|li| {
        li.timestamp += 86_401;
    });

    // Window reset — should be able to mint again
    client.minter_mint(&minter, &recipient, &500);
    assert_eq!(client.balance(&recipient), 1000);
}

#[test]
fn test_minter_mint_emits_event() {
    use soroban_sdk::{testutils::Events as _, Symbol};

    let (e, _, minter, client) = setup();
    let recipient = Address::generate(&e);
    client.set_minter_limit(&minter, &1000);
    client.minter_mint(&minter, &recipient, &300);

    let target = Symbol::new(&e, "mtr_mint");
    let found = e.events().all().iter().rev().any(|ev| {
        ev.1.get(0)
            .and_then(|t| soroban_sdk::Symbol::try_from_val(&e, &t).ok())
            .map(|s| s == target)
            .unwrap_or(false)
    });
    assert!(found, "mtr_mint event must be emitted");
}
