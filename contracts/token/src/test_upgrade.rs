#![cfg(test)]

use crate::{SoroMintToken, SoroMintTokenClient};
use soroban_sdk::{testutils::Address as _, Address, BytesN, Env, String};

#[test]
fn test_upgrade_logic() {
    let e = Env::default();
    e.mock_all_auths();

    let admin = Address::generate(&e);
    let contract_id = e.register(SoroMintToken, ());
    let client = SoroMintTokenClient::new(&e, &contract_id);

    client.initialize(
        &admin,
        &7,
        &String::from_str(&e, "SoroMint"),
        &String::from_str(&e, "SMT"),
    );

    assert_eq!(client.get_version(), 1);

    // In tests, we can just use a dummy hash to verify the logic flow
    // though the actual WASM update might not "change" the logic in a simple test without re-registering.
    // However, the state update (version) will verify the function executed.
    let dummy_hash = BytesN::from_array(&e, &[1u8; 32]);
    
    // In Soroban tests, update_current_contract_wasm will succeed if e.mock_all_auths() is on
    // even if the hash doesn't point to a real recorded WASM (it just updates the registration).
    client.upgrade(&dummy_hash);

    assert_eq!(client.get_version(), 2);
}

#[test]
fn test_state_preservation_after_upgrade() {
    let e = Env::default();
    e.mock_all_auths();

    let admin = Address::generate(&e);
    let user = Address::generate(&e);
    let contract_id = e.register(SoroMintToken, ());
    let client = SoroMintTokenClient::new(&e, &contract_id);

    client.initialize(
        &admin,
        &7,
        &String::from_str(&e, "SoroMint"),
        &String::from_str(&e, "SMT"),
    );

    // Initial state
    client.mint(&user, &1000);
    assert_eq!(client.balance(&user), 1000);
    assert_eq!(client.get_version(), 1);

    // Upgrade
    let dummy_hash = BytesN::from_array(&e, &[2u8; 32]);
    client.upgrade(&dummy_hash);

    // State should be preserved
    assert_eq!(client.balance(&user), 1000);
    assert_eq!(client.get_version(), 2);
    assert_eq!(client.name(), String::from_str(&e, "SoroMint"));
}

#[test]
#[should_panic]
fn test_upgrade_auth() {
    let e = Env::default();
    // Do NOT mock all auths here to test explicit auth failure
    
    let admin = Address::generate(&e);
    let non_admin = Address::generate(&e);
    let contract_id = e.register(SoroMintToken, ());
    let client = SoroMintTokenClient::new(&e, &contract_id);

    client.initialize(
        &admin,
        &7,
        &String::from_str(&e, "SoroMint"),
        &String::from_str(&e, "SMT"),
    );

    // This should fail because it's called as non_admin (or without admin signature)
    e.set_auths(&[]); // Ensure no auths are mocked
    
    // We expect this to panic because require_auth() will fail
    client.upgrade(&BytesN::from_array(&e, &[3u8; 32]));
}
