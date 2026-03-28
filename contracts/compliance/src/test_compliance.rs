#![cfg(test)]

use super::*;
use soroban_sdk::{contract, contractimpl, testutils::{Address as _, Events as _}, Address, Env, IntoVal};

#[contract]
pub struct ComplianceTestContract;

#[contractimpl]
impl ComplianceTestContract {
    pub fn set_blacklist(e: Env, admin: Address, addr: Address, banned: bool) {
        set_blacklist_status(e, admin, addr, banned);
    }

    pub fn check(e: Env, addr: Address) {
        require_not_blacklisted(&e, addr);
    }

    pub fn is_banned(e: Env, addr: Address) -> bool {
        is_blacklisted(&e, addr)
    }
}

#[test]
fn test_successful_blacklist_and_unblacklist() {
    let e = Env::default();
    e.mock_all_auths();

    let contract_id = e.register(ComplianceTestContract, ());
    let client = ComplianceTestContractClient::new(&e, &contract_id);

    let admin = Address::generate(&e);
    let user = Address::generate(&e);

    assert!(!client.is_banned(&user));
    client.check(&user);

    client.set_blacklist(&admin, &user, &true);
    assert!(client.is_banned(&user));

    client.set_blacklist(&admin, &user, &false);
    assert!(!client.is_banned(&user));
    client.check(&user);
}

#[test]
#[should_panic(expected = "Address is blacklisted")]
fn test_blacklist_denial_panics() {
    let e = Env::default();
    e.mock_all_auths();

    let contract_id = e.register(ComplianceTestContract, ());
    let client = ComplianceTestContractClient::new(&e, &contract_id);

    let admin = Address::generate(&e);
    let banned_user = Address::generate(&e);

    client.set_blacklist(&admin, &banned_user, &true);
    client.check(&banned_user);
}

#[test]
fn test_event_emitted() {
    let e = Env::default();
    e.mock_all_auths();

    let contract_id = e.register(ComplianceTestContract, ());
    let client = ComplianceTestContractClient::new(&e, &contract_id);

    let admin = Address::generate(&e);
    let user = Address::generate(&e);

    client.set_blacklist(&admin, &user, &true);

    let events = e.events().all();
    let last_event = events.last().expect("Event should be emitted");
    let topic0: Symbol = last_event.1.get(0).unwrap().into_val(&e);
    let topic1: Address = last_event.1.get(1).unwrap().into_val(&e);
    assert_eq!(topic0, BLACKLIST_UPDATED);
    assert_eq!(topic1, admin);

    let val: (Address, bool) = last_event.2.into_val(&e);
    assert_eq!(val.0, user);
    assert_eq!(val.1, true);
}

// --- ComplianceContract unit tests (task 5.3) ---

#[test]
fn test_version_returns_expected() {
    let e = Env::default();
    let id = e.register(ComplianceContract, ());
    let client = ComplianceContractClient::new(&e, &id);
    assert_eq!(client.version(), soroban_sdk::String::from_str(&e, "1.0.0"));
}

#[test]
fn test_status_returns_alive() {
    let e = Env::default();
    let id = e.register(ComplianceContract, ());
    let client = ComplianceContractClient::new(&e, &id);
    assert_eq!(client.status(), soroban_sdk::String::from_str(&e, "alive"));
}

#[test]
fn test_version_idempotent() {
    let e = Env::default();
    let id = e.register(ComplianceContract, ());
    let client = ComplianceContractClient::new(&e, &id);
    assert_eq!(client.version(), client.version());
}

#[test]
fn test_status_idempotent() {
    let e = Env::default();
    let id = e.register(ComplianceContract, ());
    let client = ComplianceContractClient::new(&e, &id);
    assert_eq!(client.status(), client.status());
}

// --- Property tests (tasks 5.4–5.8) ---

use proptest::prelude::*;

proptest! {
    // Feature: contract-versioning-health, Property 1: version idempotence
    #[test]
    fn prop_version_idempotent(_seed: u64) {
        let e = Env::default();
        let id = e.register(ComplianceContract, ());
        let client = ComplianceContractClient::new(&e, &id);
        prop_assert_eq!(client.version(), client.version());
    }

    // Feature: contract-versioning-health, Property 2: status idempotence
    #[test]
    fn prop_status_idempotent(_seed: u64) {
        let e = Env::default();
        let id = e.register(ComplianceContract, ());
        let client = ComplianceContractClient::new(&e, &id);
        prop_assert_eq!(client.status(), client.status());
    }

    // Feature: contract-versioning-health, Property 3: version conforms to semver format
    #[test]
    fn prop_version_semver_format(_seed: u64) {
        let e = Env::default();
        let id = e.register(ComplianceContract, ());
        let client = ComplianceContractClient::new(&e, &id);
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
        let id = e.register(ComplianceContract, ());
        let client = ComplianceContractClient::new(&e, &id);
        prop_assert_eq!(client.status(), soroban_sdk::String::from_str(&e, "alive"));
    }

    // Feature: contract-versioning-health, Property 5: version and status require no authorization
    #[test]
    fn prop_no_auth_required(_seed: u64) {
        let e = Env::default();
        // Intentionally no e.mock_all_auths()
        let id = e.register(ComplianceContract, ());
        let client = ComplianceContractClient::new(&e, &id);
        let _ = client.version();
        let _ = client.status();
    }
}
