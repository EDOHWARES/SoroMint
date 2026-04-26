#![cfg(test)]

use super::*;
use proptest::prelude::*;
use proptest::proptest;
use soroban_sdk::{
    testutils::{Address as _, Events as _},
    Address, Env, String, TryFromVal
};

fn setup() -> (Env, Address, Address, SoroMintTokenClient<'static>) {
    let e = Env::default();
    e.mock_all_auths();

    let admin = Address::generate(&e);
    let user = Address::generate(&e);
    let token_id = e.register(SoroMintToken, ());
    let client = SoroMintTokenClient::new(&e, &token_id);

    client.initialize(
        &admin,
        &7,
        &String::from_str(&e, "SoroMint"),
        &String::from_str(&e, "SMT"),
    );

    (e, admin, user, client)
}

#[test]
fn test_default_is_transferable() {
    let (_, _, _, client) = setup();
    assert!(client.is_transferable(), "token should be transferable by default");
}

#[test]
fn test_set_transferable_toggle() {
    let (_, _, _, client) = setup();

    client.set_transferable(&false);
    assert!(!client.is_transferable());

    client.set_transferable(&true);
    assert!(client.is_transferable());
}

#[test]
#[should_panic(expected = "Token is non-transferable")]
fn test_transfer_blocked_when_non_transferable() {
    let (e, _, user1, client) = setup();
    let user2 = Address::generate(&e);
    client.mint(&user1, &1000);
    client.set_transferable(&false);
    client.transfer(&user1, &user2, &100);
}

#[test]
#[should_panic(expected = "Token is non-transferable")]
fn test_transfer_from_blocked_when_non_transferable() {
    let (e, _, user1, client) = setup();
    let spender = Address::generate(&e);
    let user2 = Address::generate(&e);

    client.mint(&user1, &1000);
    client.approve(&user1, &spender, &500, &999);
    client.set_transferable(&false);

    client.transfer_from(&spender, &user1, &user2, &100);
}

#[test]
#[should_panic(expected = "Token is non-transferable")]
fn test_approve_blocked_when_non_transferable() {
    let (e, _, user1, client) = setup();
    let spender = Address::generate(&e);
    client.set_transferable(&false);
    client.approve(&user1, &spender, &500, &999);
}

#[test]
#[should_panic(expected = "Token is non-transferable")]
fn test_burn_from_blocked_when_non_transferable() {
    let (e, _, user1, client) = setup();
    let spender = Address::generate(&e);

    client.mint(&user1, &1000);
    client.approve(&user1, &spender, &500, &999);
    client.set_transferable(&false);

    client.burn_from(&spender, &user1, &100);
}

#[test]
fn test_self_burn_allowed_when_non_transferable() {
    let (_, _, user, client) = setup();
    client.mint(&user, &1000);
    client.set_transferable(&false);
    client.burn(&user, &400);
    assert_eq!(client.balance(&user), 600);
    assert_eq!(client.supply(), 600);
}

#[test]
fn test_mint_allowed_when_non_transferable() {
    let (_, _, user, client) = setup();
    client.set_transferable(&false);
    client.mint(&user, &500);
    assert_eq!(client.balance(&user), 500);
}

#[test]
fn test_transfer_works_after_re_enabling() {
    let (e, _, user1, client) = setup();
    let user2 = Address::generate(&e);

    client.mint(&user1, &1000);
    client.set_transferable(&false);
    client.set_transferable(&true);
    client.transfer(&user1, &user2, &300);

    assert_eq!(client.balance(&user1), 700);
    assert_eq!(client.balance(&user2), 300);
}

#[test]
fn test_set_transferable_emits_event() {
    use soroban_sdk::{symbol_short, IntoVal};

    let (e, admin, _, client) = setup();

    client.set_transferable(&false);

    let events = e.events().all();
    let target_sym = symbol_short!("xferable");
    let found = events.iter().rev().find(|ev| {
        if let Some(t0) = ev.1.get(0) {
            if let Ok(s) = soroban_sdk::Symbol::try_from_val(&e, &t0) {
                return s == target_sym;
            }
        }
        false
    });
    let ev = found.expect("xferable event must be emitted");

    let topic_admin: Address = ev.1.get(1).unwrap().into_val(&e);
    assert_eq!(topic_admin, admin);

    let flag: bool = ev.2.into_val(&e);
    assert!(!flag);
}

#[test]
#[should_panic]
fn test_set_transferable_requires_admin_auth() {
    let e = Env::default();
    let admin = Address::generate(&e);
    let token_id = e.register(SoroMintToken, ());
    let client = SoroMintTokenClient::new(&e, &token_id);

    client.initialize(
        &admin,
        &7,
        &String::from_str(&e, "SoroMint"),
        &String::from_str(&e, "SMT"),
    );

    client.set_transferable(&false);
}

proptest! {
    #[test]
    fn prop_is_transferable_idempotent(_seed: u64) {
        let (_, _, _, client) = setup();
        prop_assert_eq!(client.is_transferable(), client.is_transferable());
    }

    #[test]
    fn prop_set_then_get_transferable(v: bool) {
        let (_, _, _, client) = setup();
        client.set_transferable(&v);
        prop_assert_eq!(client.is_transferable(), v);
    }

    #[test]
    fn prop_set_transferable_idempotent(v: bool) {
        let (_, _, _, client) = setup();
        client.set_transferable(&v);
        client.set_transferable(&v);
        prop_assert_eq!(client.is_transferable(), v);
    }
}