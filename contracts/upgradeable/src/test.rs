#![cfg(test)]

use super::*;
use soroban_sdk::{testutils::Address as _, Address, BytesN, Env};

#[test]
fn test_initialize_and_version() {
    let e = Env::default();
    e.mock_all_auths();

    let admin = Address::generate(&e);
    let contract_id = e.register(Upgradeable, ());
    let client = UpgradeableClient::new(&e, &contract_id);

    client.initialize(&admin);
    assert_eq!(client.get_admin(), admin);
    assert_eq!(client.get_version(), 1);
}

#[test]
fn test_set_admin() {
    let e = Env::default();
    e.mock_all_auths();

    let admin = Address::generate(&e);
    let new_admin = Address::generate(&e);
    let contract_id = e.register(Upgradeable, ());
    let client = UpgradeableClient::new(&e, &contract_id);

    client.initialize(&admin);
    client.set_admin(&new_admin);
    assert_eq!(client.get_admin(), new_admin);
}

#[test]
#[should_panic(expected = "already initialized")]
fn test_double_initialize() {
    let e = Env::default();
    e.mock_all_auths();

    let admin = Address::generate(&e);
    let contract_id = e.register(Upgradeable, ());
    let client = UpgradeableClient::new(&e, &contract_id);

    client.initialize(&admin);
    client.initialize(&admin); // should panic
}
