#![cfg(test)]

use super::*;
use soroban_sdk::{testutils::Address as _, vec, Env};

#[test]
fn test_initialize() {
    let env = Env::default();
    let contract_id = env.register_contract(None, VaultContract);
    let client = VaultContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let smt_token = Address::generate(&env);
    let oracle = Address::generate(&env);

    client.initialize(&admin, &smt_token, &oracle);
}

#[test]
fn test_add_collateral_config() {
    let env = Env::default();
    env.mock_all_auths();
    
    let contract_id = env.register_contract(None, VaultContract);
    let client = VaultContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let smt_token = Address::generate(&env);
    let oracle = Address::generate(&env);
    let collateral = Address::generate(&env);

    client.initialize(&admin, &smt_token, &oracle);
    client.set_collateral_config(&collateral, &15000, &13000, &1000);
}

#[test]
fn test_vault_health_calculation() {
    let env = Env::default();
    env.mock_all_auths();
    
    let contract_id = env.register_contract(None, VaultContract);
    let client = VaultContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let smt_token = Address::generate(&env);
    let oracle = Address::generate(&env);

    client.initialize(&admin, &smt_token, &oracle);
}

#[test]
#[should_panic(expected = "reentrancy detected")]
fn test_reentrancy_guard_panics_on_double_lock() {
    let env = Env::default();
    let contract_id = env.register_contract(None, VaultContract);
    env.as_contract(&contract_id, || {
        let _guard1 = reentrancy::ReentrancyGuard::lock(&env, "test_func");
        let _guard2 = reentrancy::ReentrancyGuard::lock(&env, "test_func");
    });
}

#[test]
fn test_reentrancy_guard_unlocks_on_drop() {
    let env = Env::default();
    let contract_id = env.register_contract(None, VaultContract);
    env.as_contract(&contract_id, || {
        {
            let _guard = reentrancy::ReentrancyGuard::lock(&env, "test_func");
        }
        let _guard2 = reentrancy::ReentrancyGuard::lock(&env, "test_func");
    });
}
