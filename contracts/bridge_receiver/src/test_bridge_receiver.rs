#![cfg(test)]

use super::*;
use soroban_sdk::{testutils::Address as _, Address, Bytes, BytesN, Env};

#[test]
fn test_initialize() {
    let env = Env::default();
    let admin = Address::generate(&env);
    let token_contract = Address::generate(&env);
    
    env.mock_all_auths();
    
    initialize(&env, admin.clone(), token_contract);
    
    assert!(is_relayer(&env, &admin));
    assert_eq!(get_signal_count(&env), 0);
    assert!(!is_paused(&env));
}

#[test]
fn test_pause_unpause() {
    let env = Env::default();
    let admin = Address::generate(&env);
    let token_contract = Address::generate(&env);
    
    env.mock_all_auths();
    
    initialize(&env, admin.clone(), token_contract);
    
    pause(&env, admin.clone());
    assert!(is_paused(&env));
    
    unpause(&env, admin.clone());
    assert!(!is_paused(&env));
}

#[test]
fn test_add_remove_relayer() {
    let env = Env::default();
    let admin = Address::generate(&env);
    let token_contract = Address::generate(&env);
    let relayer = Address::generate(&env);
    
    env.mock_all_auths();
    
    initialize(&env, admin.clone(), token_contract);
    add_relayer(&env, admin.clone(), relayer.clone());
    
    assert!(is_relayer(&env, &relayer));
    
    remove_relayer(&env, admin.clone(), relayer.clone());
    assert!(!is_relayer(&env, &relayer));
}

#[test]
fn test_receive_mint_signal() {
    let env = Env::default();
    let admin = Address::generate(&env);
    let token_contract = Address::generate(&env);
    let recipient = Address::generate(&env);
    
    env.mock_all_auths();
    
    initialize(&env, admin.clone(), token_contract);
    
    let source_tx_hash = BytesN::from_array(&env, &[1u8; 32]);
    let verification_proof = Bytes::from_array(&env, &[2u8; 64]);
    
    let signal_id = receive_mint_signal(
        &env,
        admin.clone(),
        SourceChain::Ethereum,
        source_tx_hash.clone(),
        recipient.clone(),
        1000,
        1,
        verification_proof.clone(),
    );
    
    assert_eq!(signal_id, 0);
    assert_eq!(get_signal_count(&env), 1);
    
    let signal = get_signal(&env, signal_id).unwrap();
    assert_eq!(signal.signal_id, 0);
    assert_eq!(signal.recipient, recipient);
    assert_eq!(signal.amount, 1000);
    assert_eq!(signal.status, BridgeStatus::Pending);
}

#[test]
fn test_execute_mint_signal() {
    let env = Env::default();
    let admin = Address::generate(&env);
    let token_contract = Address::generate(&env);
    let recipient = Address::generate(&env);
    
    env.mock_all_auths();
    
    initialize(&env, admin.clone(), token_contract);
    
    let source_tx_hash = BytesN::from_array(&env, &[1u8; 32]);
    let verification_proof = Bytes::from_array(&env, &[2u8; 64]);
    
    let signal_id = receive_mint_signal(
        &env,
        admin.clone(),
        SourceChain::Ethereum,
        source_tx_hash.clone(),
        recipient.clone(),
        1000,
        1,
        verification_proof,
    );
    
    let success = execute_mint_signal(&env, admin.clone(), signal_id);
    
    assert!(success);
    
    let signal = get_signal(&env, signal_id).unwrap();
    assert_eq!(signal.status, BridgeStatus::Executed);
    
    // Check that transaction is marked as processed
    assert!(is_tx_processed(&env, &source_tx_hash));
}

#[test]
#[should_panic(expected = "Transaction already processed")]
fn test_replay_protection() {
    let env = Env::default();
    let admin = Address::generate(&env);
    let token_contract = Address::generate(&env);
    let recipient = Address::generate(&env);
    
    env.mock_all_auths();
    
    initialize(&env, admin.clone(), token_contract);
    
    let source_tx_hash = BytesN::from_array(&env, &[1u8; 32]);
    let verification_proof = Bytes::from_array(&env, &[2u8; 64]);
    
    // First signal
    let signal_id = receive_mint_signal(
        &env,
        admin.clone(),
        SourceChain::Ethereum,
        source_tx_hash.clone(),
        recipient.clone(),
        1000,
        1,
        verification_proof.clone(),
    );
    
    execute_mint_signal(&env, admin.clone(), signal_id);
    
    // Try to submit same transaction again - should panic
    receive_mint_signal(
        &env,
        admin.clone(),
        SourceChain::Ethereum,
        source_tx_hash,
        recipient,
        1000,
        2,
        verification_proof,
    );
}

#[test]
#[should_panic(expected = "Contract is paused")]
fn test_paused_receive_signal() {
    let env = Env::default();
    let admin = Address::generate(&env);
    let token_contract = Address::generate(&env);
    let recipient = Address::generate(&env);
    
    env.mock_all_auths();
    
    initialize(&env, admin.clone(), token_contract);
    pause(&env, admin.clone());
    
    let source_tx_hash = BytesN::from_array(&env, &[1u8; 32]);
    let verification_proof = Bytes::from_array(&env, &[2u8; 64]);
    
    // Should panic because contract is paused
    receive_mint_signal(
        &env,
        admin,
        SourceChain::Ethereum,
        source_tx_hash,
        recipient,
        1000,
        1,
        verification_proof,
    );
}

#[test]
#[should_panic(expected = "Invalid amount")]
fn test_invalid_amount() {
    let env = Env::default();
    let admin = Address::generate(&env);
    let token_contract = Address::generate(&env);
    let recipient = Address::generate(&env);
    
    env.mock_all_auths();
    
    initialize(&env, admin.clone(), token_contract);
    
    let source_tx_hash = BytesN::from_array(&env, &[1u8; 32]);
    let verification_proof = Bytes::from_array(&env, &[2u8; 64]);
    
    // Should panic with invalid amount
    receive_mint_signal(
        &env,
        admin,
        SourceChain::Ethereum,
        source_tx_hash,
        recipient,
        0, // Invalid amount
        1,
        verification_proof,
    );
}

#[test]
fn test_get_signals() {
    let env = Env::default();
    let admin = Address::generate(&env);
    let token_contract = Address::generate(&env);
    let recipient = Address::generate(&env);
    
    env.mock_all_auths();
    
    initialize(&env, admin.clone(), token_contract);
    
    // Create multiple signals
    for i in 0..5 {
        let source_tx_hash = BytesN::from_array(&env, &[i as u8; 32]);
        let verification_proof = Bytes::from_array(&env, &[i as u8; 64]);
        
        receive_mint_signal(
            &env,
            admin.clone(),
            SourceChain::Ethereum,
            source_tx_hash,
            recipient.clone(),
            1000 * (i as i128 + 1),
            i as u64,
            verification_proof,
        );
    }
    
    assert_eq!(get_signal_count(&env), 5);
    
    // Get signals 0-3
    let signals = get_signals(&env, 0, 3);
    assert_eq!(signals.len(), 3);
    assert_eq!(signals.get(0).unwrap().signal_id, 0);
    assert_eq!(signals.get(2).unwrap().signal_id, 2);
}

#[test]
#[should_panic(expected = "Unauthorized: not a relayer")]
fn test_unauthorized_relayer() {
    let env = Env::default();
    let admin = Address::generate(&env);
    let token_contract = Address::generate(&env);
    let unauthorized = Address::generate(&env);
    let recipient = Address::generate(&env);
    
    env.mock_all_auths();
    
    initialize(&env, admin.clone(), token_contract);
    
    let source_tx_hash = BytesN::from_array(&env, &[1u8; 32]);
    let verification_proof = Bytes::from_array(&env, &[2u8; 64]);
    
    // Should panic - unauthorized relayer
    receive_mint_signal(
        &env,
        unauthorized,
        SourceChain::Ethereum,
        source_tx_hash,
        recipient,
        1000,
        1,
        verification_proof,
    );
}
