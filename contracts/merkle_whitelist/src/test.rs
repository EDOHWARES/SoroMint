#![cfg(test)]

use super::*;
use crate::merkle::{compute_leaf, compute_merkle_root, generate_proof};
use soroban_sdk::{
    testutils::Address as _,
    Address, BytesN, Env, Vec,
};

fn create_test_tree(e: &Env, addresses: &Vec<Address>) -> (BytesN<32>, Vec<Vec<BytesN<32>>>) {
    // Compute leaves
    let mut leaves = Vec::new(e);
    for addr in addresses.iter() {
        let leaf = compute_leaf(e, &addr);
        leaves.push_back(leaf);
    }

    // Compute root
    let root = compute_merkle_root(e, &leaves);

    // Generate proofs for each address
    let mut proofs = Vec::new(e);
    for i in 0..addresses.len() {
        let proof = generate_proof(e, &leaves, i);
        proofs.push_back(proof);
    }

    (root, proofs)
}

#[test]
fn test_initialize() {
    let e = Env::default();
    let admin = Address::generate(&e);
    let root = BytesN::from_array(&e, &[1u8; 32]);

    let contract_id = e.register(MerkleWhitelist, ());
    let client = MerkleWhitelistClient::new(&e, &contract_id);

    client.initialize(&admin, &root);

    assert_eq!(client.get_merkle_root(), root);
    assert_eq!(client.get_root_version(), 1);
    assert_eq!(client.get_admin(), admin);
}

#[test]
#[should_panic(expected = "already initialized")]
fn test_initialize_twice() {
    let e = Env::default();
    let admin = Address::generate(&e);
    let root = BytesN::from_array(&e, &[1u8; 32]);

    let contract_id = e.register(MerkleWhitelist, ());
    let client = MerkleWhitelistClient::new(&e, &contract_id);

    client.initialize(&admin, &root);
    client.initialize(&admin, &root); // Should panic
}

#[test]
fn test_update_merkle_root() {
    let e = Env::default();
    e.mock_all_auths();

    let admin = Address::generate(&e);
    let root1 = BytesN::from_array(&e, &[1u8; 32]);
    let root2 = BytesN::from_array(&e, &[2u8; 32]);

    let contract_id = e.register(MerkleWhitelist, ());
    let client = MerkleWhitelistClient::new(&e, &contract_id);

    client.initialize(&admin, &root1);
    assert_eq!(client.get_root_version(), 1);

    client.update_merkle_root(&root2);
    assert_eq!(client.get_merkle_root(), root2);
    assert_eq!(client.get_root_version(), 2);
}

#[test]
fn test_verify_whitelist_single_address() {
    let e = Env::default();
    e.mock_all_auths();

    let admin = Address::generate(&e);
    let whitelisted = Address::generate(&e);

    let contract_id = e.register(MerkleWhitelist, ());
    let client = MerkleWhitelistClient::new(&e, &contract_id);

    // Create tree with single address
    let mut addresses = Vec::new(&e);
    addresses.push_back(whitelisted.clone());

    let (root, proofs) = create_test_tree(&e, &addresses);

    client.initialize(&admin, &root);

    // Verify the whitelisted address
    let proof = proofs.get(0).unwrap();
    assert!(client.verify_whitelist(&whitelisted, &proof));
}

#[test]
fn test_verify_whitelist_multiple_addresses() {
    let e = Env::default();
    e.mock_all_auths();

    let admin = Address::generate(&e);

    let contract_id = e.register(MerkleWhitelist, ());
    let client = MerkleWhitelistClient::new(&e, &contract_id);

    // Create tree with multiple addresses
    let mut addresses = Vec::new(&e);
    for _ in 0..10 {
        addresses.push_back(Address::generate(&e));
    }

    let (root, proofs) = create_test_tree(&e, &addresses);

    client.initialize(&admin, &root);

    // Verify all addresses
    for i in 0..addresses.len() {
        let addr = addresses.get(i).unwrap();
        let proof = proofs.get(i).unwrap();
        assert!(client.verify_whitelist(&addr, &proof));
    }
}

#[test]
fn test_verify_whitelist_invalid_proof() {
    let e = Env::default();
    e.mock_all_auths();

    let admin = Address::generate(&e);
    let whitelisted = Address::generate(&e);
    let not_whitelisted = Address::generate(&e);

    let contract_id = e.register(MerkleWhitelist, ());
    let client = MerkleWhitelistClient::new(&e, &contract_id);

    // Create tree with one address
    let mut addresses = Vec::new(&e);
    addresses.push_back(whitelisted.clone());

    let (root, proofs) = create_test_tree(&e, &addresses);

    client.initialize(&admin, &root);

    // Try to verify non-whitelisted address with wrong proof
    let proof = proofs.get(0).unwrap();
    assert!(!client.verify_whitelist(&not_whitelisted, &proof));
}

#[test]
fn test_claim_whitelist() {
    let e = Env::default();
    e.mock_all_auths();

    let admin = Address::generate(&e);
    let whitelisted = Address::generate(&e);

    let contract_id = e.register(MerkleWhitelist, ());
    let client = MerkleWhitelistClient::new(&e, &contract_id);

    // Create tree
    let mut addresses = Vec::new(&e);
    addresses.push_back(whitelisted.clone());

    let (root, proofs) = create_test_tree(&e, &addresses);

    client.initialize(&admin, &root);

    // Claim whitelist
    let proof = proofs.get(0).unwrap();
    client.claim_whitelist(&whitelisted, &proof);
}

#[test]
#[should_panic(expected = "invalid merkle proof")]
fn test_claim_whitelist_invalid() {
    let e = Env::default();
    e.mock_all_auths();

    let admin = Address::generate(&e);
    let whitelisted = Address::generate(&e);
    let not_whitelisted = Address::generate(&e);

    let contract_id = e.register(MerkleWhitelist, ());
    let client = MerkleWhitelistClient::new(&e, &contract_id);

    // Create tree
    let mut addresses = Vec::new(&e);
    addresses.push_back(whitelisted.clone());

    let (root, proofs) = create_test_tree(&e, &addresses);

    client.initialize(&admin, &root);

    // Try to claim with invalid proof
    let proof = proofs.get(0).unwrap();
    client.claim_whitelist(&not_whitelisted, &proof); // Should panic
}

#[test]
fn test_verify_with_nonce() {
    let e = Env::default();
    e.mock_all_auths();

    let admin = Address::generate(&e);
    let whitelisted = Address::generate(&e);

    let contract_id = e.register(MerkleWhitelist, ());
    let client = MerkleWhitelistClient::new(&e, &contract_id);

    // Create tree
    let mut addresses = Vec::new(&e);
    addresses.push_back(whitelisted.clone());

    let (root, proofs) = create_test_tree(&e, &addresses);

    client.initialize(&admin, &root);

    // Verify with nonce
    let proof = proofs.get(0).unwrap();
    assert!(client.verify_with_nonce(&whitelisted, &proof, &1));

    // Check nonce is marked as used
    assert!(client.is_nonce_used(&whitelisted, &1));
}

#[test]
#[should_panic(expected = "nonce already used")]
fn test_verify_with_nonce_replay() {
    let e = Env::default();
    e.mock_all_auths();

    let admin = Address::generate(&e);
    let whitelisted = Address::generate(&e);

    let contract_id = e.register(MerkleWhitelist, ());
    let client = MerkleWhitelistClient::new(&e, &contract_id);

    // Create tree
    let mut addresses = Vec::new(&e);
    addresses.push_back(whitelisted.clone());

    let (root, proofs) = create_test_tree(&e, &addresses);

    client.initialize(&admin, &root);

    // Verify with nonce
    let proof = proofs.get(0).unwrap();
    client.verify_with_nonce(&whitelisted, &proof, &1);

    // Try to use same nonce again - should panic
    client.verify_with_nonce(&whitelisted, &proof, &1);
}

#[test]
fn test_batch_verify() {
    let e = Env::default();
    e.mock_all_auths();

    let admin = Address::generate(&e);

    let contract_id = e.register(MerkleWhitelist, ());
    let client = MerkleWhitelistClient::new(&e, &contract_id);

    // Create tree with multiple addresses
    let mut addresses = Vec::new(&e);
    for _ in 0..5 {
        addresses.push_back(Address::generate(&e));
    }

    let (root, proofs) = create_test_tree(&e, &addresses);

    client.initialize(&admin, &root);

    // Batch verify
    let results = client.batch_verify(&addresses, &proofs);

    // All should be valid
    for i in 0..results.len() {
        assert!(results.get(i).unwrap());
    }
}

#[test]
fn test_batch_verify_mixed() {
    let e = Env::default();
    e.mock_all_auths();

    let admin = Address::generate(&e);

    let contract_id = e.register(MerkleWhitelist, ());
    let client = MerkleWhitelistClient::new(&e, &contract_id);

    // Create tree with some addresses
    let mut whitelisted_addresses = Vec::new(&e);
    for _ in 0..3 {
        whitelisted_addresses.push_back(Address::generate(&e));
    }

    let (root, proofs) = create_test_tree(&e, &whitelisted_addresses);

    client.initialize(&admin, &root);

    // Create test batch with valid and invalid addresses
    let mut test_addresses = Vec::new(&e);
    let mut test_proofs = Vec::new(&e);

    // Add valid address
    test_addresses.push_back(whitelisted_addresses.get(0).unwrap());
    test_proofs.push_back(proofs.get(0).unwrap());

    // Add invalid address with wrong proof
    test_addresses.push_back(Address::generate(&e));
    test_proofs.push_back(proofs.get(1).unwrap());

    let results = client.batch_verify(&test_addresses, &test_proofs);

    assert!(results.get(0).unwrap()); // First should be valid
    assert!(!results.get(1).unwrap()); // Second should be invalid
}

#[test]
fn test_transfer_admin() {
    let e = Env::default();
    e.mock_all_auths();

    let admin = Address::generate(&e);
    let new_admin = Address::generate(&e);
    let root = BytesN::from_array(&e, &[1u8; 32]);

    let contract_id = e.register(MerkleWhitelist, ());
    let client = MerkleWhitelistClient::new(&e, &contract_id);

    client.initialize(&admin, &root);
    assert_eq!(client.get_admin(), admin);

    client.transfer_admin(&new_admin);
    assert_eq!(client.get_admin(), new_admin);
}

#[test]
fn test_get_config() {
    let e = Env::default();
    e.mock_all_auths();

    let admin = Address::generate(&e);
    let root = BytesN::from_array(&e, &[1u8; 32]);

    let contract_id = e.register(MerkleWhitelist, ());
    let client = MerkleWhitelistClient::new(&e, &contract_id);

    client.initialize(&admin, &root);

    let config = client.get_config();
    assert_eq!(config.merkle_root, root);
    assert_eq!(config.version, 1);
}

#[test]
fn test_large_whitelist() {
    let e = Env::default();
    e.mock_all_auths();

    let admin = Address::generate(&e);

    let contract_id = e.register(MerkleWhitelist, ());
    let client = MerkleWhitelistClient::new(&e, &contract_id);

    // Create tree with many addresses (simulating thousands)
    let mut addresses = Vec::new(&e);
    for _ in 0..100 {
        // Using 100 for test, but same logic works for thousands
        addresses.push_back(Address::generate(&e));
    }

    let (root, proofs) = create_test_tree(&e, &addresses);

    client.initialize(&admin, &root);

    // Verify random addresses from the list
    for i in [0, 25, 50, 75, 99] {
        let addr = addresses.get(i).unwrap();
        let proof = proofs.get(i).unwrap();
        assert!(client.verify_whitelist(&addr, &proof));
    }
}
