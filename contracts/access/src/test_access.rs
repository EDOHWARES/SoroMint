#![cfg(test)]

use super::*;
use soroban_sdk::{contract, contractimpl, testutils::{Address as _, Events as _}, Address, Env, IntoVal};

#[contract]
pub struct AccessTestContract;

#[contractimpl]
impl AccessTestContract {
    pub fn init_admin(e: Env, admin: Address) {
        initialize_admin(&e, admin);
    }

    pub fn grant(e: Env, granter: Address, user: Address, role: u32) {
        let role_enum = match role {
            1 => Role::Admin,
            2 => Role::Minter,
            3 => Role::Pauser,
            _ => panic!("Invalid role"),
        };
        grant_role(e, granter, user, role_enum);
    }

    pub fn revoke(e: Env, revoker: Address, user: Address, role: u32) {
        let role_enum = match role {
            1 => Role::Admin,
            2 => Role::Minter,
            3 => Role::Pauser,
            _ => panic!("Invalid role"),
        };
        revoke_role(e, revoker, user, role_enum);
    }

    pub fn check(e: Env, user: Address, role: u32) {
        let role_enum = match role {
            1 => Role::Admin,
            2 => Role::Minter,
            3 => Role::Pauser,
            _ => panic!("Invalid role"),
        };
        require_role(&e, user, role_enum);
    }

    pub fn has(e: Env, user: Address, role: u32) -> bool {
        let role_enum = match role {
            1 => Role::Admin,
            2 => Role::Minter,
            3 => Role::Pauser,
            _ => panic!("Invalid role"),
        };
        has_role(&e, user, role_enum)
    }
}

#[test]
fn test_successful_role_lifecycle() {
    let e = Env::default();
    e.mock_all_auths();

    let contract_id = e.register(AccessTestContract, ());
    let client = AccessTestContractClient::new(&e, &contract_id);

    let admin = Address::generate(&e);
    let minter = Address::generate(&e);

    client.init_admin(&admin);
    assert!(client.has(&admin, &1));

    client.grant(&admin, &minter, &2);
    assert!(client.has(&minter, &2));
    client.check(&minter, &2);

    client.revoke(&admin, &minter, &2);
    assert!(!client.has(&minter, &2));
}

#[test]
#[should_panic(expected = "Missing required role")]
fn test_unauthorized_action_panics() {
    let e = Env::default();
    e.mock_all_auths();

    let contract_id = e.register(AccessTestContract, ());
    let client = AccessTestContractClient::new(&e, &contract_id);

    let user = Address::generate(&e);
    client.check(&user, &2);
}

#[test]
#[should_panic(expected = "Missing required role")]
fn test_non_admin_cannot_grant_roles() {
    let e = Env::default();
    e.mock_all_auths();

    let contract_id = e.register(AccessTestContract, ());
    let client = AccessTestContractClient::new(&e, &contract_id);

    let attacker = Address::generate(&e);
    let user = Address::generate(&e);

    client.grant(&attacker, &user, &1);
}

#[test]
fn test_events_emitted() {
    let e = Env::default();
    e.mock_all_auths();

    let contract_id = e.register(AccessTestContract, ());
    let client = AccessTestContractClient::new(&e, &contract_id);

    let admin = Address::generate(&e);
    let user = Address::generate(&e);

    client.init_admin(&admin);
    client.grant(&admin, &user, &2);

    let events = e.events().all();
    let last_event = events.last().expect("Event should be emitted");
    
    let t0: Symbol = last_event.1.get(0).unwrap().into_val(&e);
    let t1: Address = last_event.1.get(1).unwrap().into_val(&e);
    assert_eq!(t0, ROLE_GRANTED);
    assert_eq!(t1, admin);

    let val: (Address, u32) = last_event.2.into_val(&e);
    assert_eq!(val.0, user);
    assert_eq!(val.1, 2);
}

// --- AccessContract unit tests (tasks 4.3) ---

#[test]
fn test_version_returns_expected() {
    let e = Env::default();
    let id = e.register(AccessContract, ());
    let client = AccessContractClient::new(&e, &id);
    assert_eq!(client.version(), soroban_sdk::String::from_str(&e, "1.0.0"));
}

#[test]
fn test_status_returns_alive() {
    let e = Env::default();
    let id = e.register(AccessContract, ());
    let client = AccessContractClient::new(&e, &id);
    assert_eq!(client.status(), soroban_sdk::String::from_str(&e, "alive"));
}

#[test]
fn test_version_idempotent() {
    let e = Env::default();
    let id = e.register(AccessContract, ());
    let client = AccessContractClient::new(&e, &id);
    assert_eq!(client.version(), client.version());
}

#[test]
fn test_status_idempotent() {
    let e = Env::default();
    let id = e.register(AccessContract, ());
    let client = AccessContractClient::new(&e, &id);
    assert_eq!(client.status(), client.status());
}

// --- Property tests (tasks 4.4–4.8) ---

use proptest::prelude::*;

proptest! {
    // Feature: contract-versioning-health, Property 1: version idempotence
    #[test]
    fn prop_version_idempotent(_seed: u64) {
        let e = Env::default();
        let id = e.register(AccessContract, ());
        let client = AccessContractClient::new(&e, &id);
        prop_assert_eq!(client.version(), client.version());
    }

    // Feature: contract-versioning-health, Property 2: status idempotence
    #[test]
    fn prop_status_idempotent(_seed: u64) {
        let e = Env::default();
        let id = e.register(AccessContract, ());
        let client = AccessContractClient::new(&e, &id);
        prop_assert_eq!(client.status(), client.status());
    }

    // Feature: contract-versioning-health, Property 3: version conforms to semver format
    #[test]
    fn prop_version_semver_format(_seed: u64) {
        let e = Env::default();
        let id = e.register(AccessContract, ());
        let client = AccessContractClient::new(&e, &id);
        let v = client.version();
        let mut buf = [0u8; 32];
        let len = v.len() as usize;
        v.copy_into_slice(&mut buf[..len]);
        // semver: three dot-separated numeric segments
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
        let id = e.register(AccessContract, ());
        let client = AccessContractClient::new(&e, &id);
        prop_assert_eq!(client.status(), soroban_sdk::String::from_str(&e, "alive"));
    }

    // Feature: contract-versioning-health, Property 5: version and status require no authorization
    #[test]
    fn prop_no_auth_required(_seed: u64) {
        let e = Env::default();
        // Intentionally no e.mock_all_auths()
        let id = e.register(AccessContract, ());
        let client = AccessContractClient::new(&e, &id);
        let _ = client.version();
        let _ = client.status();
    }
}
