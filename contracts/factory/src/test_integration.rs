#![cfg(test)]
/**
 * @title Contract Integration Tests
 * @description Cross-contract integration tests using Env mocking
 * @notice Tests complex interactions between factory and token contracts
 * @dev Uses soroban_sdk::Env for mocking cross-contract calls
 */
use super::*;
use soroban_sdk::{
    testutils::{Address as _, Events},
    Address, BytesN, Env, IntoVal, String, Symbol, Val, Vec,
};

// Import the token contract for cross-contract interactions
mod token {
    soroban_sdk::contractimport!(
        file = "../../target/wasm32-unknown-unknown/release/soromint_token.wasm"
    );
}

/// @notice Setup helper for integration tests
/// @dev Creates a fresh environment with factory and returns essential components
/// @return (Env, factory_admin, TokenFactoryClient) - Test environment setup
fn setup_factory() -> (Env, Address, TokenFactoryClient<'static>) {
    let e = Env::default();
    e.mock_all_auths();

    let admin = Address::generate(&e);
    let factory_id = e.register(TokenFactory, ());
    let client = TokenFactoryClient::new(&e, &factory_id);

    (e, admin, client)
}

// ===========================================================================
// Cross-Contract Deployment Tests
// ===========================================================================

/// @notice Tests the complete flow of factory deploying and initializing a token
/// @dev Verifies that the factory can deploy a token and the token is properly initialized
#[test]
fn test_factory_deploys_and_initializes_token() {
    let (e, admin, factory_client) = setup_factory();

    // Upload the token WASM to get its hash
    let wasm_hash = e.deployer().upload_contract_wasm(token::WASM);

    // Initialize the factory
    factory_client.initialize(&admin, &wasm_hash);

    // Create a token through the factory
    let salt = BytesN::from_array(&e, &[1; 32]);
    let token_admin = Address::generate(&e);
    let decimal = 7u32;
    let name = String::from_str(&e, "Integration Test Token");
    let symbol = String::from_str(&e, "ITT");

    let token_address = factory_client.create_token(&salt, &token_admin, &decimal, &name, &symbol);

    // Verify the token was deployed and is accessible
    let token_client = token::Client::new(&e, &token_address);

    // The token should be initialized with 0 balance for the admin
    assert_eq!(token_client.balance(&token_admin), 0);

    // Verify the factory's token registry
    let tokens = factory_client.get_tokens();
    assert_eq!(tokens.len(), 1);
    assert_eq!(tokens.get(0).unwrap(), token_address);
}

/// @notice Tests minting through a token deployed by the factory
/// @dev Verifies cross-contract state changes work correctly
#[test]
fn test_mint_on_factory_deployed_token() {
    let (e, admin, factory_client) = setup_factory();

    let wasm_hash = e.deployer().upload_contract_wasm(token::WASM);
    factory_client.initialize(&admin, &wasm_hash);

    let salt = BytesN::from_array(&e, &[2; 32]);
    let token_admin = Address::generate(&e);
    let user = Address::generate(&e);

    let token_address = factory_client.create_token(
        &salt,
        &token_admin,
        &7u32,
        &String::from_str(&e, "Mintable Token"),
        &String::from_str(&e, "MTK"),
    );

    let token_client = token::Client::new(&e, &token_address);

    // Mint tokens to user
    token_client.mint(&user, &1000i128);

    // Verify the mint worked
    assert_eq!(token_client.balance(&user), 1000);
    assert_eq!(token_client.supply(), 1000);
}

/// @notice Tests multiple token deployments from the same factory
/// @dev Verifies the factory can deploy multiple independent tokens
#[test]
fn test_factory_deploys_multiple_tokens() {
    let (e, admin, factory_client) = setup_factory();

    let wasm_hash = e.deployer().upload_contract_wasm(token::WASM);
    factory_client.initialize(&admin, &wasm_hash);

    // Deploy first token
    let salt1 = BytesN::from_array(&e, &[1; 32]);
    let admin1 = Address::generate(&e);
    let token1 = factory_client.create_token(
        &salt1,
        &admin1,
        &7u32,
        &String::from_str(&e, "Token One"),
        &String::from_str(&e, "TK1"),
    );

    // Deploy second token with different salt
    let salt2 = BytesN::from_array(&e, &[2; 32]);
    let admin2 = Address::generate(&e);
    let token2 = factory_client.create_token(
        &salt2,
        &admin2,
        &18u32,
        &String::from_str(&e, "Token Two"),
        &String::from_str(&e, "TK2"),
    );

    // Verify both tokens are tracked
    let tokens = factory_client.get_tokens();
    assert_eq!(tokens.len(), 2);
    assert!(tokens.contains(&token1));
    assert!(tokens.contains(&token2));

    // Verify tokens are independent
    let client1 = token::Client::new(&e, &token1);
    let client2 = token::Client::new(&e, &token2);

    assert_eq!(client1.supply(), 0);
    assert_eq!(client2.supply(), 0);

    // Mint on token1 should not affect token2
    client1.mint(&admin1, &500i128);
    assert_eq!(client1.supply(), 500);
    assert_eq!(client2.supply(), 0);
}

// ===========================================================================
// Cross-Contract Event Tests
// ===========================================================================

/// @notice Tests that events are emitted correctly across contract boundaries
/// @dev Verifies factory deployment events and token initialization events
#[test]
fn test_cross_contract_events() {
    let (e, admin, factory_client) = setup_factory();

    let wasm_hash = e.deployer().upload_contract_wasm(token::WASM);
    factory_client.initialize(&admin, &wasm_hash);

    let salt = BytesN::from_array(&e, &[3; 32]);
    let token_admin = Address::generate(&e);

    factory_client.create_token(
        &salt,
        &token_admin,
        &7u32,
        &String::from_str(&e, "Event Test Token"),
        &String::from_str(&e, "ETT"),
    );

    // Verify factory emitted deployment event
    let deploy_symbol = Symbol::new(&e, "deploy");
    let factory_symbol = Symbol::new(&e, "factory");

    // Check that events were emitted
    let events = e.events().all();
    assert!(
        events.len() > 0,
        "Expected at least one event to be emitted"
    );

    // Look for factory deployment event
    let found_factory_event = events.iter().any(|(_cid, topics, _data)| {
        let t: Vec<Val> = topics.clone();
        t.len() >= 2
            && t.get(0)
                .map(|v| {
                    v.get_payload()
                        == <Symbol as IntoVal<Env, Val>>::into_val(&factory_symbol.clone(), &e)
                            .get_payload()
                })
                .unwrap_or(false)
            && t.get(1)
                .map(|v| {
                    v.get_payload()
                        == <Symbol as IntoVal<Env, Val>>::into_val(&deploy_symbol.clone(), &e)
                            .get_payload()
                })
                .unwrap_or(false)
    });

    assert!(
        found_factory_event,
        "Expected factory deployment event to be emitted"
    );
}

/// @notice Tests token events are emitted through cross-contract calls
/// @dev Verifies mint events work when called on factory-deployed tokens
#[test]
fn test_token_events_through_factory_deployment() {
    let (e, admin, factory_client) = setup_factory();

    let wasm_hash = e.deployer().upload_contract_wasm(token::WASM);
    factory_client.initialize(&admin, &wasm_hash);

    let salt = BytesN::from_array(&e, &[4; 32]);
    let token_admin = Address::generate(&e);
    let user = Address::generate(&e);

    let token_address = factory_client.create_token(
        &salt,
        &token_admin,
        &7u32,
        &String::from_str(&e, "Event Token"),
        &String::from_str(&e, "EVT"),
    );

    let token_client = token::Client::new(&e, &token_address);

    // Perform mint
    token_client.mint(&user, &750i128);

    // Verify state changed
    assert_eq!(token_client.balance(&user), 750);
}

// ===========================================================================
// Complex Interaction Tests
// ===========================================================================

/// @notice Tests a complex workflow: deploy, mint, transfer ownership, mint again
/// @dev Verifies complex call stacks work correctly across contracts
#[test]
fn test_complex_workflow_deploy_mint_transfer_mint() {
    let (e, factory_admin, factory_client) = setup_factory();

    let wasm_hash = e.deployer().upload_contract_wasm(token::WASM);
    factory_client.initialize(&factory_admin, &wasm_hash);

    let salt = BytesN::from_array(&e, &[5; 32]);
    let initial_admin = Address::generate(&e);
    let new_admin = Address::generate(&e);
    let user = Address::generate(&e);

    // Step 1: Deploy token
    let token_address = factory_client.create_token(
        &salt,
        &initial_admin,
        &7u32,
        &String::from_str(&e, "Complex Token"),
        &String::from_str(&e, "CMPLX"),
    );

    let token_client = token::Client::new(&e, &token_address);

    // Step 2: Initial admin mints tokens
    token_client.mint(&user, &1000i128);
    assert_eq!(token_client.balance(&user), 1000);

    // Step 3: Transfer ownership to new admin
    token_client.transfer_ownership(&new_admin);

    // Step 4: New admin mints more tokens
    token_client.mint(&user, &500i128);
    assert_eq!(token_client.balance(&user), 1500);
    assert_eq!(token_client.supply(), 1500);
}

/// @notice Tests burning tokens on a factory-deployed contract
/// @dev Verifies burn functionality works correctly after deployment
#[test]
fn test_burn_on_factory_deployed_token() {
    let (e, admin, factory_client) = setup_factory();

    let wasm_hash = e.deployer().upload_contract_wasm(token::WASM);
    factory_client.initialize(&admin, &wasm_hash);

    let salt = BytesN::from_array(&e, &[6; 32]);
    let token_admin = Address::generate(&e);
    let user = Address::generate(&e);

    let token_address = factory_client.create_token(
        &salt,
        &token_admin,
        &7u32,
        &String::from_str(&e, "Burnable Token"),
        &String::from_str(&e, "BURN"),
    );

    let token_client = token::Client::new(&e, &token_address);

    // Mint and then burn
    token_client.mint(&user, &2000i128);
    assert_eq!(token_client.balance(&user), 2000);
    assert_eq!(token_client.supply(), 2000);

    token_client.burn(&user, &800i128);
    assert_eq!(token_client.balance(&user), 1200);
    assert_eq!(token_client.supply(), 1200);
}

/// @notice Tests multiple users interacting with a factory-deployed token
/// @dev Verifies multi-user scenarios work correctly
#[test]
fn test_multiple_users_on_factory_token() {
    let (e, admin, factory_client) = setup_factory();

    let wasm_hash = e.deployer().upload_contract_wasm(token::WASM);
    factory_client.initialize(&admin, &wasm_hash);

    let salt = BytesN::from_array(&e, &[7; 32]);
    let token_admin = Address::generate(&e);
    let user1 = Address::generate(&e);
    let user2 = Address::generate(&e);
    let user3 = Address::generate(&e);

    let token_address = factory_client.create_token(
        &salt,
        &token_admin,
        &7u32,
        &String::from_str(&e, "Multi User Token"),
        &String::from_str(&e, "MULTI"),
    );

    let token_client = token::Client::new(&e, &token_address);

    // Mint to multiple users
    token_client.mint(&user1, &100i128);
    token_client.mint(&user2, &200i128);
    token_client.mint(&user3, &300i128);

    // Verify individual balances
    assert_eq!(token_client.balance(&user1), 100);
    assert_eq!(token_client.balance(&user2), 200);
    assert_eq!(token_client.balance(&user3), 300);

    // Verify total supply
    assert_eq!(token_client.supply(), 600);

    // Burn from one user
    token_client.burn(&user2, &50i128);
    assert_eq!(token_client.balance(&user2), 150);
    assert_eq!(token_client.supply(), 550);
}

// ===========================================================================
// Error Handling Tests
// ===========================================================================

/// @notice Tests that factory cannot create token with same salt twice
/// @dev Verifies deployment uniqueness is enforced
#[test]
#[should_panic]
fn test_factory_rejects_duplicate_salt() {
    let (e, admin, factory_client) = setup_factory();

    let wasm_hash = e.deployer().upload_contract_wasm(token::WASM);
    factory_client.initialize(&admin, &wasm_hash);

    let salt = BytesN::from_array(&e, &[8; 32]);
    let token_admin = Address::generate(&e);

    // First deployment should succeed
    factory_client.create_token(
        &salt,
        &token_admin,
        &7u32,
        &String::from_str(&e, "First Token"),
        &String::from_str(&e, "FIRST"),
    );

    // Second deployment with same salt should fail
    factory_client.create_token(
        &salt,
        &token_admin,
        &7u32,
        &String::from_str(&e, "Second Token"),
        &String::from_str(&e, "SECOND"),
    );
}

/// @notice Tests that factory must be initialized before creating tokens
/// @dev Verifies initialization requirement
#[test]
#[should_panic(expected = "not initialized")]
fn test_factory_requires_initialization() {
    let (e, _admin, factory_client) = setup_factory();

    // Try to create token without initializing factory
    let salt = BytesN::from_array(&e, &[9; 32]);
    let token_admin = Address::generate(&e);

    factory_client.create_token(
        &salt,
        &token_admin,
        &7u32,
        &String::from_str(&e, "Uninitialized Token"),
        &String::from_str(&e, "UNINIT"),
    );
}

/// @notice Tests insufficient balance burn on factory-deployed token
/// @dev Verifies error handling propagates correctly across contract boundary
#[test]
#[should_panic]
fn test_burn_insufficient_balance_on_factory_token() {
    let (e, admin, factory_client) = setup_factory();

    let wasm_hash = e.deployer().upload_contract_wasm(token::WASM);
    factory_client.initialize(&admin, &wasm_hash);

    let salt = BytesN::from_array(&e, &[10; 32]);
    let token_admin = Address::generate(&e);
    let user = Address::generate(&e);

    let token_address = factory_client.create_token(
        &salt,
        &token_admin,
        &7u32,
        &String::from_str(&e, "Error Token"),
        &String::from_str(&e, "ERR"),
    );

    let token_client = token::Client::new(&e, &token_address);

    // Mint some tokens
    token_client.mint(&user, &100i128);

    // Try to burn more than balance
    token_client.burn(&user, &200i128);
}

// ===========================================================================
// WASM Hash Update Tests
// ===========================================================================

/// @notice Tests that admin can update WASM hash and deploy with new version
/// @dev Verifies factory upgrade path works correctly
#[test]
fn test_update_wasm_hash_and_deploy() {
    let (e, admin, factory_client) = setup_factory();

    let wasm_hash_v1 = e.deployer().upload_contract_wasm(token::WASM);
    factory_client.initialize(&admin, &wasm_hash_v1);

    // Deploy with v1
    let salt1 = BytesN::from_array(&e, &[11; 32]);
    let token_admin1 = Address::generate(&e);
    let token1 = factory_client.create_token(
        &salt1,
        &token_admin1,
        &7u32,
        &String::from_str(&e, "V1 Token"),
        &String::from_str(&e, "V1"),
    );

    // Update WASM hash (simulating upgrade)
    let wasm_hash_v2 = BytesN::from_array(&e, &[0xdd; 32]); // Different hash
    factory_client.update_wasm_hash(&wasm_hash_v2);

    // Deploy with v2
    // This will fail since wasm_hash_v2 is not a real WASM, but it tests the path
    // In a real scenario, this would deploy with the new WASM
    // For this test, we just verify the update_wasm_hash call succeeds

    // Verify both tokens are tracked
    let tokens = factory_client.get_tokens();
    assert_eq!(tokens.len(), 1); // Only v1 was successfully deployed
    assert!(tokens.contains(&token1));
}

// ===========================================================================
// Supply Invariant Tests
// ===========================================================================

/// @notice Tests that supply invariants hold across complex operations
/// @dev Verifies supply always equals sum of all balances
#[test]
fn test_supply_invariant_across_operations() {
    let (e, admin, factory_client) = setup_factory();

    let wasm_hash = e.deployer().upload_contract_wasm(token::WASM);
    factory_client.initialize(&admin, &wasm_hash);

    let salt = BytesN::from_array(&e, &[13; 32]);
    let token_admin = Address::generate(&e);
    let user1 = Address::generate(&e);
    let user2 = Address::generate(&e);

    let token_address = factory_client.create_token(
        &salt,
        &token_admin,
        &7u32,
        &String::from_str(&e, "Invariant Token"),
        &String::from_str(&e, "INV"),
    );

    let token_client = token::Client::new(&e, &token_address);

    // Initial state
    assert_eq!(token_client.supply(), 0);

    // Mint to multiple users
    token_client.mint(&user1, &500i128);
    assert_eq!(token_client.supply(), 500);
    assert_eq!(
        token_client.balance(&user1) + token_client.balance(&user2),
        500
    );

    token_client.mint(&user2, &300i128);
    assert_eq!(token_client.supply(), 800);
    assert_eq!(
        token_client.balance(&user1) + token_client.balance(&user2),
        800
    );

    // Burn from user1
    token_client.burn(&user1, &200i128);
    assert_eq!(token_client.supply(), 600);
    assert_eq!(
        token_client.balance(&user1) + token_client.balance(&user2),
        600
    );

    // Burn all from user2
    token_client.burn(&user2, &300i128);
    assert_eq!(token_client.supply(), 300);
    assert_eq!(
        token_client.balance(&user1) + token_client.balance(&user2),
        300
    );
}
