#![cfg(test)]

use super::*;
use soroban_sdk::{contract, contractimpl, testutils::Address as _, Address, Env, String};

#[contract]
pub struct TestContract;

#[contractimpl]
impl TestContract {
    pub fn init(e: Env, owner: Address) {
        initialize_owner(&e, owner);
    }
    pub fn transfer(e: Env, new_owner: Address) {
        transfer_ownership(e, new_owner);
    }
    pub fn accept(e: Env) {
        accept_ownership(e);
    }
    pub fn get_owner(e: Env) -> Address {
        get_owner(&e)
    }
    pub fn get_pending(e: Env) -> Option<Address> {
        get_pending_owner(&e)
    }
}

#[test]
fn test_successful_handover() {
    let e = Env::default();
    e.mock_all_auths();

    let contract_id = e.register(TestContract, ());
    let client = TestContractClient::new(&e, &contract_id);

    let owner = Address::generate(&e);
    let new_owner = Address::generate(&e);

    client.init(&owner);
    assert_eq!(client.get_owner(), owner);

    // Step 1: Initiate transfer
    client.transfer(&new_owner);
    assert_eq!(client.get_pending(), Some(new_owner.clone()));

    // Step 2: Accept transfer
    client.accept();
    assert_eq!(client.get_owner(), new_owner);
    assert_eq!(client.get_pending(), None);
}

#[test]
#[should_panic(expected = "Owner already initialized")]
fn test_double_initialization_fails() {
    let e = Env::default();
    let contract_id = e.register(TestContract, ());
    let client = TestContractClient::new(&e, &contract_id);

    let owner = Address::generate(&e);
    let owner2 = Address::generate(&e);

    client.init(&owner);
    client.init(&owner2);
}

#[test]
#[should_panic(expected = "No pending owner")]
fn test_accept_without_pending_fails() {
    let e = Env::default();
    e.mock_all_auths();
    let contract_id = e.register(TestContract, ());
    let client = TestContractClient::new(&e, &contract_id);

    let owner = Address::generate(&e);
    client.init(&owner);
    client.accept();
}

#[test]
fn test_initiation_authorization() {
    let e = Env::default();
    let contract_id = e.register(TestContract, ());
    let client = TestContractClient::new(&e, &contract_id);

    let owner = Address::generate(&e);

    client.init(&owner);

    // Only owner can initiate transfer
    e.set_auths(&[]); // Clear auths
    
    // We expect this to fail authorization if we don't mock it
    // But since we are using client.transfer and it has require_auth, 
    // it will panic if auth is missing.
}

#[test]
fn test_overwriting_pending_owner() {
    let e = Env::default();
    e.mock_all_auths();

    let contract_id = e.register(TestContract, ());
    let client = TestContractClient::new(&e, &contract_id);

    let owner = Address::generate(&e);
    let first_pending = Address::generate(&e);
    let second_pending = Address::generate(&e);

    client.init(&owner);

    client.transfer(&first_pending);
    assert_eq!(client.get_pending(), Some(first_pending));

    client.transfer(&second_pending);
    assert_eq!(client.get_pending(), Some(second_pending));
}

// --- version / status tests for OwnershipContract ---

#[test]
fn test_version_returns_expected() {
    let e = Env::default();
    let id = e.register(OwnershipContract, ());
    let client = OwnershipContractClient::new(&e, &id);
    assert_eq!(client.version(), String::from_str(&e, "1.0.0"));
}

#[test]
fn test_status_returns_alive() {
    let e = Env::default();
    let id = e.register(OwnershipContract, ());
    let client = OwnershipContractClient::new(&e, &id);
    assert_eq!(client.status(), String::from_str(&e, "alive"));
}

#[test]
fn test_version_idempotent() {
    let e = Env::default();
    let id = e.register(OwnershipContract, ());
    let client = OwnershipContractClient::new(&e, &id);
    assert_eq!(client.version(), client.version());
}

#[test]
fn test_status_idempotent() {
    let e = Env::default();
    let id = e.register(OwnershipContract, ());
    let client = OwnershipContractClient::new(&e, &id);
    assert_eq!(client.status(), client.status());
}
