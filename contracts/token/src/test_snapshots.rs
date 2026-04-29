#![cfg(test)]

use super::*;
use soroban_sdk::{testutils::Address as _, Address, Env, String, TryFromVal};
use soroban_sdk::testutils::Ledger as _;

fn setup() -> (Env, Address, Address, SoroMintTokenClient<'static>) {
    let e = Env::default();
    e.mock_all_auths();
    let admin = Address::generate(&e);
    let user = Address::generate(&e);
    let token_id = e.register(SoroMintToken, ());
    let client = SoroMintTokenClient::new(&e, &token_id);
    client.initialize(&admin, &7, &String::from_str(&e, "SoroMint"), &String::from_str(&e, "SMT"));
    (e, admin, user, client)
}

#[test]
fn test_take_snapshot_records_balance() {
    let (e, _, user, client) = setup();
    client.mint(&user, &1000);

    let ledger = client.take_snapshot(&user);
    assert_eq!(ledger, e.ledger().sequence());
    assert_eq!(client.snapshot_balance(&user, &ledger), Some(1000));
}

#[test]
fn test_snapshot_balance_returns_none_if_not_recorded() {
    let (_, _, user, client) = setup();
    assert_eq!(client.snapshot_balance(&user, &100), None);
}

#[test]
fn test_snapshot_reflects_balance_at_time_of_snapshot() {
    let (e, _, user, client) = setup();
    client.mint(&user, &500);

    let ledger1 = client.take_snapshot(&user);
    assert_eq!(client.snapshot_balance(&user, &ledger1), Some(500));

    client.mint(&user, &300);
    assert_eq!(client.balance(&user), 800);
    assert_eq!(client.snapshot_balance(&user, &ledger1), Some(500));

    let ledger2 = client.take_snapshot(&user);
    assert_eq!(client.snapshot_balance(&user, &ledger2), Some(800));
}

#[test]
fn test_snapshot_at_different_ledger_heights() {
    let (e, _, user, client) = setup();
    client.mint(&user, &100);

    let ledger1 = e.ledger().sequence();
    client.take_snapshot(&user);

    e.ledger().with_mut(|li| {
        li.sequence_number += 10;
    });

    client.mint(&user, &200);
    let ledger2 = e.ledger().sequence();
    client.take_snapshot(&user);

    assert_eq!(client.snapshot_balance(&user, &ledger1), Some(100));
    assert_eq!(client.snapshot_balance(&user, &ledger2), Some(300));
}

#[test]
fn test_take_supply_snapshot_records_total_supply() {
    let (e, _, user, client) = setup();
    client.mint(&user, &1000);

    let ledger = client.take_supply_snapshot();
    assert_eq!(ledger, e.ledger().sequence());
    assert_eq!(client.snapshot_supply(&ledger), Some(1000));
}

#[test]
fn test_supply_snapshot_reflects_supply_at_time() {
    let (e, _, user, client) = setup();
    let user2 = Address::generate(&e);

    client.mint(&user, &500);
    let ledger1 = client.take_supply_snapshot();
    assert_eq!(client.snapshot_supply(&ledger1), Some(500));

    client.mint(&user2, &300);
    assert_eq!(client.supply(), 800);
    assert_eq!(client.snapshot_supply(&ledger1), Some(500));

    let ledger2 = client.take_supply_snapshot();
    assert_eq!(client.snapshot_supply(&ledger2), Some(800));
}

#[test]
fn test_snapshot_supply_returns_none_if_not_recorded() {
    let (_, _, _, client) = setup();
    assert_eq!(client.snapshot_supply(&999), None);
}

#[test]
fn test_snapshot_taken_event_emitted() {
    use soroban_sdk::{testutils::Events as _, Symbol};

    let (e, _, user, client) = setup();
    client.mint(&user, &1000);
    client.take_snapshot(&user);

    let target = Symbol::new(&e, "snapshot");
    let found = e.events().all().iter().rev().any(|ev| {
        ev.1.get(0)
            .and_then(|t| Symbol::try_from_val(&e, &t).ok())
            .map(|s| s == target)
            .unwrap_or(false)
    });
    assert!(found, "snapshot event must be emitted");
}

#[test]
fn test_supply_snapshot_taken_event_emitted() {
    use soroban_sdk::{symbol_short, testutils::Events as _, Symbol};

    let (e, _, user, client) = setup();
    client.mint(&user, &1000);
    client.take_supply_snapshot();

    let target = symbol_short!("sup_snap");
    let found = e.events().all().iter().rev().any(|ev| {
        ev.1.get(0)
            .and_then(|t| Symbol::try_from_val(&e, &t).ok())
            .map(|s| s == target)
            .unwrap_or(false)
    });
    assert!(found, "sup_snap event must be emitted");
}

#[test]
fn test_multiple_accounts_snapshots_independent() {
    let (e, _, user1, client) = setup();
    let user2 = Address::generate(&e);

    client.mint(&user1, &100);
    client.mint(&user2, &200);

    let ledger = e.ledger().sequence();
    client.take_snapshot(&user1);
    client.take_snapshot(&user2);

    assert_eq!(client.snapshot_balance(&user1, &ledger), Some(100));
    assert_eq!(client.snapshot_balance(&user2, &ledger), Some(200));
}

#[test]
fn test_snapshot_after_burn() {
    let (e, _, user, client) = setup();
    client.mint(&user, &1000);
    client.burn(&user, &300);

    let ledger = client.take_snapshot(&user);
    assert_eq!(client.snapshot_balance(&user, &ledger), Some(700));
}

#[test]
fn test_snapshot_after_transfer() {
    let (e, _, user1, client) = setup();
    let user2 = Address::generate(&e);

    client.mint(&user1, &1000);
    client.transfer(&user1, &user2, &400);

    let ledger = e.ledger().sequence();
    client.take_snapshot(&user1);
    client.take_snapshot(&user2);

    assert_eq!(client.snapshot_balance(&user1, &ledger), Some(600));
    assert_eq!(client.snapshot_balance(&user2, &ledger), Some(400));
}
