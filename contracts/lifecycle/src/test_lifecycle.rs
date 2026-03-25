#![cfg(test)]

use super::*;
use soroban_sdk::{contract, contractimpl, testutils::{Address as _, Events as _}, Address, Env, IntoVal};

#[contract]
pub struct LifecycleTestContract;

#[contractimpl]
impl LifecycleTestContract {
    pub fn do_pause(e: Env, admin: Address) {
        pause(e, admin);
    }

    pub fn do_unpause(e: Env, admin: Address) {
        unpause(e, admin);
    }

    pub fn check_paused(e: Env) -> bool {
        is_paused(&e)
    }

    pub fn do_action(e: Env) {
        require_not_paused(&e);
    }
}

#[test]
fn test_pause_unpause_lifecycle() {
    let e = Env::default();
    e.mock_all_auths();

    let contract_id = e.register(LifecycleTestContract, ());
    let client = LifecycleTestContractClient::new(&e, &contract_id);
    let admin = Address::generate(&e);

    // Initial state: not paused
    assert_eq!(client.check_paused(), false);
    client.do_action(); // Should not panic

    // Pause the contract
    client.do_pause(&admin);
    assert_eq!(client.check_paused(), true);

    // Unpause the contract
    client.do_unpause(&admin);
    assert_eq!(client.check_paused(), false);
    client.do_action(); // Should not panic again
}

#[test]
#[should_panic(expected = "Contract is paused")]
fn test_action_fails_when_paused() {
    let e = Env::default();
    e.mock_all_auths();

    let contract_id = e.register(LifecycleTestContract, ());
    let client = LifecycleTestContractClient::new(&e, &contract_id);
    let admin = Address::generate(&e);

    client.do_pause(&admin);
    
    // This should panic
    client.do_action();
}

#[test]
fn test_events_emitted() {
    let e = Env::default();
    e.mock_all_auths();

    let contract_id = e.register(LifecycleTestContract, ());
    let client = LifecycleTestContractClient::new(&e, &contract_id);
    let admin = Address::generate(&e);

    client.do_pause(&admin);
    
    let events = e.events().all();
    let last_event = events.last().expect("Event should be emitted");
    
    let t0: Symbol = last_event.1.get(0).unwrap().into_val(&e);
    let val: Address = last_event.2.into_val(&e);
    
    assert_eq!(t0, SYS_PAUSE);
    assert_eq!(val, admin);
}
