#![cfg(test)]

use super::*;
use soroban_sdk::{
    contract, contractimpl, symbol_short, testutils::Address as _, vec, Env, IntoVal,
};

/// Simple target used to verify that `execute_tx` performs a real cross-contract call.
#[contract]
struct MockTarget;

#[contractimpl]
impl MockTarget {
    pub fn set_value(e: Env, value: i128) {
        e.storage().instance().set(&symbol_short!("val"), &value);
    }

    pub fn value(e: Env) -> i128 {
        e.storage()
            .instance()
            .get(&symbol_short!("val"))
            .unwrap_or(0)
    }
}

fn setup_2_of_3(env: &Env) -> (MultiSigAdminClient<'_>, Address, Address, Address) {
    env.mock_all_auths();

    let contract_id = env.register(MultiSigAdmin, ());
    let client = MultiSigAdminClient::new(env, &contract_id);

    let signer1 = Address::generate(env);
    let signer2 = Address::generate(env);
    let signer3 = Address::generate(env);

    let signers = vec![
        env,
        signer1.clone(),
        signer2.clone(),
        signer3.clone(),
    ];
    client.initialize(&signers, &2);

    (client, signer1, signer2, signer3)
}

#[test]
fn test_initialize() {
    let env = Env::default();
    let contract_id = env.register(MultiSigAdmin, ());
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
    let contract_id = env.register(MultiSigAdmin, ());
    let client = MultiSigAdminClient::new(&env, &contract_id);

    let signer1 = Address::generate(&env);
    let signers = vec![&env, signer1];

    client.initialize(&signers, &1);
    client.initialize(&signers, &1);
}

#[test]
fn test_propose_and_approve() {
    let env = Env::default();
    let (client, signer1, signer2, _) = setup_2_of_3(&env);

    let target = Address::generate(&env);
    let function = Symbol::new(&env, "mint");
    let args = vec![
        &env,
        Address::generate(&env).into_val(&env),
        1000i128.into_val(&env),
    ];

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
fn test_execute_invokes_target_with_2_of_3() {
    let env = Env::default();
    let (client, signer1, signer2, _) = setup_2_of_3(&env);

    let target_id = env.register(MockTarget, ());
    let target_client = MockTargetClient::new(&env, &target_id);

    let function = Symbol::new(&env, "set_value");
    let args = vec![&env, 42i128.into_val(&env)];

    let tx_id = client.propose_tx(&signer1, &target_id, &function, &args);
    client.approve_tx(&signer2, &tx_id);
    client.execute_tx(&signer1, &tx_id);

    let tx = client.get_tx(&tx_id);
    assert_eq!(tx.executed, true);
    assert_eq!(target_client.value(), 42);
}

#[test]
#[should_panic(expected = "insufficient signatures")]
fn test_execute_fails_with_1_of_3() {
    let env = Env::default();
    let (client, signer1, _, _) = setup_2_of_3(&env);

    let target_id = env.register(MockTarget, ());
    let function = Symbol::new(&env, "set_value");
    let args = vec![&env, 1i128.into_val(&env)];

    let tx_id = client.propose_tx(&signer1, &target_id, &function, &args);
    client.execute_tx(&signer1, &tx_id);
}

#[test]
#[should_panic(expected = "already signed")]
fn test_duplicate_signature_rejected() {
    let env = Env::default();
    let (client, signer1, _, _) = setup_2_of_3(&env);

    let target_id = env.register(MockTarget, ());
    let function = Symbol::new(&env, "set_value");
    let args = vec![&env, 1i128.into_val(&env)];

    let tx_id = client.propose_tx(&signer1, &target_id, &function, &args);
    // Proposer already counted; approving again must not increase the threshold tally.
    client.approve_tx(&signer1, &tx_id);
}

#[test]
#[should_panic(expected = "transaction already executed")]
fn test_replay_execute_rejected() {
    let env = Env::default();
    let (client, signer1, signer2, _) = setup_2_of_3(&env);

    let target_id = env.register(MockTarget, ());
    let function = Symbol::new(&env, "set_value");
    let args = vec![&env, 7i128.into_val(&env)];

    let tx_id = client.propose_tx(&signer1, &target_id, &function, &args);
    client.approve_tx(&signer2, &tx_id);
    client.execute_tx(&signer1, &tx_id);
    client.execute_tx(&signer2, &tx_id);
}

#[test]
#[should_panic(expected = "not a signer")]
fn test_unauthorized_propose() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(MultiSigAdmin, ());
    let client = MultiSigAdminClient::new(&env, &contract_id);

    let signer1 = Address::generate(&env);
    let unauthorized = Address::generate(&env);
    let target = Address::generate(&env);

    let signers = vec![&env, signer1];
    client.initialize(&signers, &1);

    let function = Symbol::new(&env, "mint");
    let args = vec![&env, 0i128.into_val(&env)];

    client.propose_tx(&unauthorized, &target, &function, &args);
}
