#![cfg(test)]

use super::*;
use soroban_sdk::{testutils::Address as _, vec, Env};

#[test]
fn test_initialize() {
    let env = Env::default();
    let contract_id = env.register_contract(None, MultiSigAdmin);
    let client = MultiSigAdminClient::new(&env, &contract_id);

    let signer1 = Address::generate(&env);
    let signer2 = Address::generate(&env);
    let signer3 = Address::generate(&env);

    let signers = vec![&env, signer1.clone(), signer2.clone(), signer3.clone()];
    client.initialize(&signers, &2);

    assert_eq!(client.get_threshold(), 2);
    assert_eq!(client.get_signers(), signers);
}

#[test]
#[should_panic(expected = "already initialized")]
fn test_double_initialize() {
    let env = Env::default();
    let contract_id = env.register_contract(None, MultiSigAdmin);
    let client = MultiSigAdminClient::new(&env, &contract_id);

    let signer1 = Address::generate(&env);
    let signers = vec![&env, signer1];

    client.initialize(&signers, &1);
    client.initialize(&signers, &1);
}

#[test]
fn test_propose_and_approve() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register_contract(None, MultiSigAdmin);
    let client = MultiSigAdminClient::new(&env, &contract_id);

    let signer1 = Address::generate(&env);
    let signer2 = Address::generate(&env);
    let target = Address::generate(&env);

    let signers = vec![&env, signer1.clone(), signer2.clone()];
    client.initialize(&signers, &2);

    let function = Symbol::new(&env, "mint");
    let args = vec![&env, 0u8];

    let tx_id = client.propose_tx(&signer1, &target, &function, &args);
    assert_eq!(tx_id, 1);

    let tx = client.get_tx(&tx_id);
    assert_eq!(tx.id, 1);
    assert_eq!(tx.target, target);
    assert_eq!(tx.executed, false);
    assert_eq!(tx.signatures.len(), 1);

    client.approve_tx(&signer2, &tx_id);

    let tx = client.get_tx(&tx_id);
    assert_eq!(tx.signatures.len(), 2);
}

#[test]
fn test_execute_with_threshold() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register_contract(None, MultiSigAdmin);
    let client = MultiSigAdminClient::new(&env, &contract_id);

    let signer1 = Address::generate(&env);
    let signer2 = Address::generate(&env);
    let signer3 = Address::generate(&env);
    let target = Address::generate(&env);

    let signers = vec![&env, signer1.clone(), signer2.clone(), signer3.clone()];
    client.initialize(&signers, &2);

    let function = Symbol::new(&env, "mint");
    let args = vec![&env, 0u8];

    let tx_id = client.propose_tx(&signer1, &target, &function, &args);
    client.approve_tx(&signer2, &tx_id);

    client.execute_tx(&signer1, &tx_id);

    let tx = client.get_tx(&tx_id);
    assert_eq!(tx.executed, true);
}

#[test]
#[should_panic(expected = "insufficient signatures")]
fn test_execute_without_threshold() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register_contract(None, MultiSigAdmin);
    let client = MultiSigAdminClient::new(&env, &contract_id);

    let signer1 = Address::generate(&env);
    let signer2 = Address::generate(&env);
    let target = Address::generate(&env);

    let signers = vec![&env, signer1.clone(), signer2.clone()];
    client.initialize(&signers, &2);

    let function = Symbol::new(&env, "mint");
    let args = vec![&env, 0u8];

    let tx_id = client.propose_tx(&signer1, &target, &function, &args);
    
    client.execute_tx(&signer1, &tx_id);
}

#[test]
#[should_panic(expected = "not a signer")]
fn test_unauthorized_propose() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register_contract(None, MultiSigAdmin);
    let client = MultiSigAdminClient::new(&env, &contract_id);

    let signer1 = Address::generate(&env);
    let unauthorized = Address::generate(&env);
    let target = Address::generate(&env);

    let signers = vec![&env, signer1];
    client.initialize(&signers, &1);

    let function = Symbol::new(&env, "mint");
    let args = vec![&env, 0u8];

    client.propose_tx(&unauthorized, &target, &function, &args);
}
