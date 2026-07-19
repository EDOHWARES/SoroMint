#![cfg(test)]

//! Tests for factory `deploy_multisig` threshold verification (#658).

use super::*;
use crate::multisig::build_deploy_payload_hash;
use ed25519_dalek::{Signer, SigningKey};
use soroban_sdk::{testutils::Address as _, vec, Address, BytesN, Env, String};

mod token {
    // Resolved relative to this crate's Cargo.toml (contracts/factory/).
    soroban_sdk::contractimport!(file = "testdata/soromint_deploy_test_token.wasm");
}

struct OwnerKey {
    signing: SigningKey,
    public_key: BytesN<32>,
}

fn owner_from_seed(e: &Env, seed: u8) -> OwnerKey {
    let mut bytes = [0u8; 32];
    bytes[0] = seed;
    bytes[31] = seed.wrapping_mul(3);
    let signing = SigningKey::from_bytes(&bytes);
    let pk = BytesN::from_array(e, &signing.verifying_key().to_bytes());
    OwnerKey {
        signing,
        public_key: pk,
    }
}

fn sign_payload(e: &Env, owner: &OwnerKey, payload_hash: &BytesN<32>) -> OwnerSignature {
    let sig = owner.signing.sign(&payload_hash.to_array());
    OwnerSignature {
        public_key: owner.public_key.clone(),
        signature: BytesN::from_array(e, &sig.to_bytes()),
    }
}

fn setup_factory_with_owners(
    e: &Env,
) -> (
    TokenFactoryClient<'_>,
    Address,
    OwnerKey,
    OwnerKey,
    OwnerKey,
) {
    e.mock_all_auths();

    let admin = Address::generate(e);
    let factory_id = e.register(TokenFactory, ());
    let client = TokenFactoryClient::new(e, &factory_id);

    let wasm_hash = e.deployer().upload_contract_wasm(token::WASM);
    client.initialize(&admin, &wasm_hash);

    let o1 = owner_from_seed(e, 1);
    let o2 = owner_from_seed(e, 2);
    let o3 = owner_from_seed(e, 3);

    let owners = vec![
        e,
        o1.public_key.clone(),
        o2.public_key.clone(),
        o3.public_key.clone(),
    ];
    client.set_multisig_owners(&owners);

    (client, admin, o1, o2, o3)
}

fn deploy_params(e: &Env) -> (BytesN<32>, Address, u32, String, String, u64) {
    (
        BytesN::from_array(e, &[42u8; 32]),
        Address::generate(e),
        7u32,
        String::from_str(e, "Multisig Token"),
        String::from_str(e, "MST"),
        1u64,
    )
}

#[test]
fn test_deploy_multisig_succeeds_with_2_of_3() {
    let e = Env::default();
    let (client, _, o1, o2, _) = setup_factory_with_owners(&e);
    let (salt, token_admin, decimal, name, symbol, nonce) = deploy_params(&e);

    let payload = MultisigDeployPayload {
        salt: salt.clone(),
        admin: token_admin.clone(),
        decimal,
        name: name.clone(),
        symbol: symbol.clone(),
        nonce,
    };
    let payload_hash = build_deploy_payload_hash(&e, &payload);

    let signatures = vec![
        &e,
        sign_payload(&e, &o1, &payload_hash),
        sign_payload(&e, &o2, &payload_hash),
    ];

    let token_address = client.deploy_multisig(
        &salt,
        &token_admin,
        &decimal,
        &name,
        &symbol,
        &signatures,
        &2u32,
        &nonce,
    );

    let tokens = client.get_tokens();
    assert_eq!(tokens.len(), 1);
    assert_eq!(tokens.get(0).unwrap(), token_address);

    let token_client = token::Client::new(&e, &token_address);
    assert_eq!(token_client.balance(&token_admin), 0);
    assert_eq!(token_client.decimals(), decimal);
    assert_eq!(token_client.name(), name);
    assert_eq!(token_client.symbol(), symbol);
    assert_eq!(token_client.admin(), token_admin);
}

#[test]
#[should_panic(expected = "insufficient signatures")]
fn test_deploy_multisig_fails_with_1_of_3() {
    let e = Env::default();
    let (client, _, o1, _, _) = setup_factory_with_owners(&e);
    let (salt, token_admin, decimal, name, symbol, nonce) = deploy_params(&e);

    let payload = MultisigDeployPayload {
        salt: salt.clone(),
        admin: token_admin.clone(),
        decimal,
        name: name.clone(),
        symbol: symbol.clone(),
        nonce,
    };
    let payload_hash = build_deploy_payload_hash(&e, &payload);

    let signatures = vec![&e, sign_payload(&e, &o1, &payload_hash)];

    client.deploy_multisig(
        &salt,
        &token_admin,
        &decimal,
        &name,
        &symbol,
        &signatures,
        &2u32,
        &nonce,
    );
}

#[test]
#[should_panic(expected = "duplicate signature")]
fn test_deploy_multisig_rejects_duplicate_signer() {
    let e = Env::default();
    let (client, _, o1, _, _) = setup_factory_with_owners(&e);
    let (salt, token_admin, decimal, name, symbol, nonce) = deploy_params(&e);

    let payload = MultisigDeployPayload {
        salt: salt.clone(),
        admin: token_admin.clone(),
        decimal,
        name: name.clone(),
        symbol: symbol.clone(),
        nonce,
    };
    let payload_hash = build_deploy_payload_hash(&e, &payload);

    // Same key twice must not count toward the 2-of-3 threshold.
    let signatures = vec![
        &e,
        sign_payload(&e, &o1, &payload_hash),
        sign_payload(&e, &o1, &payload_hash),
    ];

    client.deploy_multisig(
        &salt,
        &token_admin,
        &decimal,
        &name,
        &symbol,
        &signatures,
        &2u32,
        &nonce,
    );
}

#[test]
#[should_panic(expected = "payload already used")]
fn test_deploy_multisig_rejects_replayed_payload() {
    let e = Env::default();
    let (client, _, o1, o2, _) = setup_factory_with_owners(&e);
    let (salt, token_admin, decimal, name, symbol, nonce) = deploy_params(&e);

    let payload = MultisigDeployPayload {
        salt: salt.clone(),
        admin: token_admin.clone(),
        decimal,
        name: name.clone(),
        symbol: symbol.clone(),
        nonce,
    };
    let payload_hash = build_deploy_payload_hash(&e, &payload);

    let signatures = vec![
        &e,
        sign_payload(&e, &o1, &payload_hash),
        sign_payload(&e, &o2, &payload_hash),
    ];

    client.deploy_multisig(
        &salt,
        &token_admin,
        &decimal,
        &name,
        &symbol,
        &signatures,
        &2u32,
        &nonce,
    );

    // Replay the same signed payload — must fail even with a different salt attempt
    // because the nonce+params hash was already consumed. Use a new salt but same
    // signed payload contents: the call still carries the original signed params.
    // Re-submitting the exact same arguments triggers replay protection.
    client.deploy_multisig(
        &salt,
        &token_admin,
        &decimal,
        &name,
        &symbol,
        &signatures,
        &2u32,
        &nonce,
    );
}

#[test]
#[should_panic(expected = "unknown owner")]
fn test_deploy_multisig_rejects_unknown_owner() {
    let e = Env::default();
    let (client, _, o1, _, _) = setup_factory_with_owners(&e);
    let (salt, token_admin, decimal, name, symbol, nonce) = deploy_params(&e);

    let payload = MultisigDeployPayload {
        salt: salt.clone(),
        admin: token_admin.clone(),
        decimal,
        name: name.clone(),
        symbol: symbol.clone(),
        nonce,
    };
    let payload_hash = build_deploy_payload_hash(&e, &payload);

    let stranger = owner_from_seed(&e, 99);
    let signatures = vec![
        &e,
        sign_payload(&e, &o1, &payload_hash),
        sign_payload(&e, &stranger, &payload_hash),
    ];

    client.deploy_multisig(
        &salt,
        &token_admin,
        &decimal,
        &name,
        &symbol,
        &signatures,
        &2u32,
        &nonce,
    );
}
