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

    // 1. Initialize admin
    client.init_admin(&admin);
    assert!(client.has(&admin, &1));

    // 2. Grant Minter role
    client.grant(&admin, &minter, &2);
    assert!(client.has(&minter, &2));
    client.check(&minter, &2);

    // 3. Revoke Minter role
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
    
    // Check for Minter role when none was granted
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

    // Attacker tries to grant themselves or others roles
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
    client.grant(&admin, &user, &2); // Grant Minter

    let events = e.events().all();
    let last_event = events.last().expect("Event should be emitted");
    
    // Topics: [ROLE_GRANTED, granter]
    let t0: Symbol = last_event.1.get(0).unwrap().into_val(&e);
    let t1: Address = last_event.1.get(1).unwrap().into_val(&e);
    assert_eq!(t0, ROLE_GRANTED);
    assert_eq!(t1, admin);

    // Values: [user, role_u32]
    let val: (Address, u32) = last_event.2.into_val(&e);
    assert_eq!(val.0, user);
    assert_eq!(val.1, 2);
}
