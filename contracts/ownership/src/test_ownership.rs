#![cfg(test)]

use super::*;
use soroban_sdk::{contract, contractimpl, testutils::Address as _, Address, Env};

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

    client.transfer(&new_owner);
    assert_eq!(client.get_pending(), Some(new_owner.clone()));

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

// --- OwnershipContract unit tests (task 6.3) ---

#[test]
fn test_version_returns_expected() {
    let e = Env::default();
    let id = e.register(OwnershipContract, ());
    let client = OwnershipContractClient::new(&e, &id);
    assert_eq!(client.version(), soroban_sdk::String::from_str(&e, "1.0.0"));
}

#[test]
fn test_status_returns_alive() {
    let e = Env::default();
    let id = e.register(OwnershipContract, ());
    let client = OwnershipContractClient::new(&e, &id);
    assert_eq!(client.status(), soroban_sdk::String::from_str(&e, "alive"));
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

// --- Property tests (tasks 6.4–6.8) ---

use proptest::prelude::*;

proptest! {
    // Feature: contract-versioning-health, Property 1: version idempotence
    #[test]
    fn prop_version_idempotent(_seed: u64) {
        let e = Env::default();
        let id = e.register(OwnershipContract, ());
        let client = OwnershipContractClient::new(&e, &id);
        prop_assert_eq!(client.version(), client.version());
    }

    // Feature: contract-versioning-health, Property 2: status idempotence
    #[test]
    fn prop_status_idempotent(_seed: u64) {
        let e = Env::default();
        let id = e.register(OwnershipContract, ());
        let client = OwnershipContractClient::new(&e, &id);
        prop_assert_eq!(client.status(), client.status());
    }

    // Feature: contract-versioning-health, Property 3: version conforms to semver format
    #[test]
    fn prop_version_semver_format(_seed: u64) {
        let e = Env::default();
        let id = e.register(OwnershipContract, ());
        let client = OwnershipContractClient::new(&e, &id);
        let v = client.version();
        let mut buf = [0u8; 32];
        let len = v.len() as usize;
        v.copy_into_slice(&mut buf[..len]);
        let dot_count = buf[..len].iter().filter(|&&b| b == b'.').count();
        prop_assert_eq!(dot_count, 2);
        for &b in &buf[..len] {
            prop_assert!(b == b'.' || b.is_ascii_digit());
        }
    }

    // Feature: contract-versioning-health, Property 4: status is always "alive"
    #[test]
    fn prop_status_is_alive(_seed: u64) {
        let e = Env::default();
        let id = e.register(OwnershipContract, ());
        let client = OwnershipContractClient::new(&e, &id);
        prop_assert_eq!(client.status(), soroban_sdk::String::from_str(&e, "alive"));
    }

    // Feature: contract-versioning-health, Property 5: version and status require no authorization
    #[test]
    fn prop_no_auth_required(_seed: u64) {
        let e = Env::default();
        // Intentionally no e.mock_all_auths()
        let id = e.register(OwnershipContract, ());
        let client = OwnershipContractClient::new(&e, &id);
        let _ = client.version();
        let _ = client.status();
    }
}
