#![cfg(test)]

use super::*;
use soroban_sdk::{testutils::Address as _, Address, BytesN, Env};

fn setup() -> (Env, Address, ProxyRouterClient<'static>) {
    let e = Env::default();
    e.mock_all_auths();

    let timelock = Address::generate(&e);
    let contract_id = e.register(ProxyRouter, ());
    let client = ProxyRouterClient::new(&e, &contract_id);
    client.initialize(&timelock);

    (e, timelock, client)
}

#[test]
fn test_initialize_and_version() {
    let (e, timelock, client) = setup();
    assert_eq!(client.get_timelock(), timelock);
    assert_eq!(client.get_admin(), timelock);
    assert_eq!(client.get_version(), 1);
    assert_eq!(client.get_schema_version(), 1);
    assert_eq!(client.get_counter(), 0);
    assert_eq!(client.version(), String::from_str(&e, "2.0.0"));
    assert_eq!(client.status(), String::from_str(&e, "alive"));
}

#[test]
#[should_panic(expected = "already initialized")]
fn test_double_initialize() {
    let (_, timelock, client) = setup();
    client.initialize(&timelock);
}

#[test]
fn test_set_counter_persists() {
    let (_, _, client) = setup();
    client.set_counter(&7);
    assert_eq!(client.get_counter(), 7);
}

#[test]
fn test_upgrade_increments_impl_version_and_preserves_state() {
    let (e, _, client) = setup();
    client.set_counter(&42);

    let dummy_hash = BytesN::from_array(&e, &[1u8; 32]);
    client.upgrade(&dummy_hash);

    assert_eq!(client.get_version(), 2);
    assert_eq!(client.get_counter(), 42);
    assert_eq!(client.get_schema_version(), 1);
}

#[test]
fn test_migrate_is_noop_on_current_schema() {
    let (_, _, client) = setup();
    client.set_counter(&3);
    client.migrate();
    assert_eq!(client.get_schema_version(), 1);
    assert_eq!(client.get_counter(), 3);
}

#[test]
#[should_panic]
fn test_upgrade_requires_auth() {
    let e = Env::default();
    let timelock = Address::generate(&e);
    let contract_id = e.register(ProxyRouter, ());
    let client = ProxyRouterClient::new(&e, &contract_id);
    client.initialize(&timelock);

    client.upgrade(&BytesN::from_array(&e, &[3u8; 32]));
}
