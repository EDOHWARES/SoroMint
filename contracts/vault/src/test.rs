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
    client.add_collateral(&collateral, &15000, &13000, &1000);
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
