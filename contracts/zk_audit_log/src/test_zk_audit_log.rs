#![cfg(test)]

use super::*;
use soroban_sdk::{testutils::Address as _, Address, BytesN, Env};

#[test]
fn test_initialize() {
    let env = Env::default();
    let admin = Address::generate(&env);
    
    env.mock_all_auths();
    
    initialize(&env, admin.clone());
    
    assert!(is_verifier(&env, &admin));
    assert_eq!(get_entry_count(&env), 0);
}

#[test]
fn test_add_remove_verifier() {
    let env = Env::default();
    let admin = Address::generate(&env);
    let verifier = Address::generate(&env);
    
    env.mock_all_auths();
    
    initialize(&env, admin.clone());
    add_verifier(&env, admin.clone(), verifier.clone());
    
    assert!(is_verifier(&env, &verifier));
    
    remove_verifier(&env, admin.clone(), verifier.clone());
    assert!(!is_verifier(&env, &verifier));
}

#[test]
fn test_log_action() {
    let env = Env::default();
    let admin = Address::generate(&env);
    
    env.mock_all_auths();
    
    initialize(&env, admin.clone());
    
    let proof_commitment = BytesN::from_array(&env, &[1u8; 32]);
    let public_data_hash = BytesN::from_array(&env, &[2u8; 32]);
    
    let entry_id = log_action(
        &env,
        admin.clone(),
        ActionType::Mint,
        proof_commitment.clone(),
        public_data_hash.clone(),
    );
    
    assert_eq!(entry_id, 0);
    assert_eq!(get_entry_count(&env), 1);
    
    let entry = get_entry(&env, entry_id).unwrap();
    assert_eq!(entry.entry_id, 0);
    assert_eq!(entry.action_type, ActionType::Mint);
    assert_eq!(entry.proof_commitment, proof_commitment);
    assert_eq!(entry.public_data_hash, public_data_hash);
    assert_eq!(entry.verifier, admin);
}

#[test]
fn test_verify_proof() {
    let env = Env::default();
    let admin = Address::generate(&env);
    
    env.mock_all_auths();
    
    initialize(&env, admin.clone());
    
    // Create proof data
    let proof_data = soroban_sdk::Bytes::from_array(&env, &[1u8; 64]);
    let proof_commitment = env.crypto().sha256(&proof_data);
    let public_data_hash = BytesN::from_array(&env, &[2u8; 32]);
    
    // Log action with commitment
    let entry_id = log_action(
        &env,
        admin.clone(),
        ActionType::Transfer,
        proof_commitment,
        public_data_hash,
    );
    
    // Verify proof
    let is_valid = verify_proof(&env, admin.clone(), entry_id, proof_data);
    
    assert!(is_valid);
    assert!(is_proof_verified(&env, entry_id));
}

#[test]
fn test_verify_proof_invalid() {
    let env = Env::default();
    let admin = Address::generate(&env);
    
    env.mock_all_auths();
    
    initialize(&env, admin.clone());
    
    // Create proof commitment
    let proof_commitment = BytesN::from_array(&env, &[1u8; 32]);
    let public_data_hash = BytesN::from_array(&env, &[2u8; 32]);
    
    // Log action
    let entry_id = log_action(
        &env,
        admin.clone(),
        ActionType::Burn,
        proof_commitment,
        public_data_hash,
    );
    
    // Try to verify with wrong proof data
    let wrong_proof_data = soroban_sdk::Bytes::from_array(&env, &[99u8; 64]);
    let is_valid = verify_proof(&env, admin.clone(), entry_id, wrong_proof_data);
    
    assert!(!is_valid);
}

#[test]
fn test_get_entries() {
    let env = Env::default();
    let admin = Address::generate(&env);
    
    env.mock_all_auths();
    
    initialize(&env, admin.clone());
    
    // Log multiple actions
    for i in 0..5 {
        let proof_commitment = BytesN::from_array(&env, &[i as u8; 32]);
        let public_data_hash = BytesN::from_array(&env, &[(i + 10) as u8; 32]);
        
        log_action(
            &env,
            admin.clone(),
            ActionType::Mint,
            proof_commitment,
            public_data_hash,
        );
    }
    
    assert_eq!(get_entry_count(&env), 5);
    
    // Get entries 0-3
    let entries = get_entries(&env, 0, 3);
    assert_eq!(entries.len(), 3);
    assert_eq!(entries.get(0).unwrap().entry_id, 0);
    assert_eq!(entries.get(2).unwrap().entry_id, 2);
}

#[test]
#[should_panic(expected = "Unauthorized: not a verifier")]
fn test_log_action_unauthorized() {
    let env = Env::default();
    let admin = Address::generate(&env);
    let unauthorized = Address::generate(&env);
    
    env.mock_all_auths();
    
    initialize(&env, admin.clone());
    
    let proof_commitment = BytesN::from_array(&env, &[1u8; 32]);
    let public_data_hash = BytesN::from_array(&env, &[2u8; 32]);
    
    // This should panic
    log_action(
        &env,
        unauthorized,
        ActionType::Mint,
        proof_commitment,
        public_data_hash,
    );
}
