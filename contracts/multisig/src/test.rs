#![cfg(test)]

use super::*;
use soroban_sdk::{testutils::Address as _, vec, Address, Bytes, BytesN, Env};

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
    let args = Bytes::from_slice(&env, &[0u8]);

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
    let args = Bytes::from_slice(&env, &[0u8]);

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
    let args = Bytes::from_slice(&env, &[0u8]);

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
    let args = Bytes::from_slice(&env, &[0u8]);

    client.propose_tx(&unauthorized, &target, &function, &args);
}

#[test]
fn test_propose_and_approve_upgrade() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(MultiSigAdmin, ());
    let client = MultiSigAdminClient::new(&env, &contract_id);

    let signer1 = Address::generate(&env);
    let signer2 = Address::generate(&env);
    let timelock = Address::generate(&env);
    let proxy = Address::generate(&env);
    let hash = BytesN::from_array(&env, &[1u8; 32]);

    client.initialize(&vec![&env, signer1.clone(), signer2.clone()], &2);

    let tx_id = client.propose_upgrade(&signer1, &timelock, &proxy, &hash);
    assert_eq!(tx_id, 1);

    let proposal = client.get_upgrade(&tx_id);
    assert_eq!(proposal.timelock, timelock);
    assert_eq!(proposal.proxy, proxy);
    assert_eq!(proposal.wasm_hash, hash);
    assert_eq!(proposal.queued, false);
    assert_eq!(proposal.signatures.len(), 1);

    client.approve_upgrade(&signer2, &tx_id);
    assert_eq!(client.get_upgrade(&tx_id).signatures.len(), 2);
}

#[test]
#[should_panic(expected = "already signed")]
fn test_double_approve_upgrade_panics() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(MultiSigAdmin, ());
    let client = MultiSigAdminClient::new(&env, &contract_id);

    let signer1 = Address::generate(&env);
    let timelock = Address::generate(&env);
    let proxy = Address::generate(&env);

    client.initialize(&vec![&env, signer1.clone()], &1);

    let tx_id = client.propose_upgrade(
        &signer1,
        &timelock,
        &proxy,
        &BytesN::from_array(&env, &[2u8; 32]),
    );
    client.approve_upgrade(&signer1, &tx_id);
}
