#![cfg(test)]

//! Tests for the DividendDistributor contract.
//!
//! Test strategy:
//! - Use `soroban_sdk::testutils` for address generation and auth mocking.
//! - Use `env.register_stellar_asset_contract(admin)` (soroban-sdk 22.x API)
//!   to create a mock XLM SAC in the test environment.
//! - `StellarAssetClient` is used to mint XLM balances for test accounts.
//! - Each test is self-contained: fresh Env + mock_all_auths.

use super::*;
use soroban_sdk::{
    testutils::Address as _,
    token::{Client as TokenClient, StellarAssetClient},
    Env,
};

// ---------------------------------------------------------------------------
// Test Helpers
// ---------------------------------------------------------------------------

/// Creates a mock XLM SAC and returns its Address.
/// In soroban-sdk 22.x, `register_stellar_asset_contract` takes an admin
/// address and returns the SAC contract Address directly.
fn create_xlm_token(env: &Env, admin: &Address) -> Address {
    env.register_stellar_asset_contract(admin.clone())
}

/// Mints `amount` stroops of the SAC token to `to`.
fn mint_xlm(env: &Env, xlm_id: &Address, admin: &Address, to: &Address, amount: i128) {
    let sac = StellarAssetClient::new(env, xlm_id);
    sac.mint(to, &amount);
}

// ---------------------------------------------------------------------------
// Initialization Tests
// ---------------------------------------------------------------------------

#[test]
fn test_initialize() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let token_contract = Address::generate(&env);
    let xlm_token = create_xlm_token(&env, &admin);

    let contract_id = env.register_contract(None, DividendDistributor);
    let client = DividendDistributorClient::new(&env, &contract_id);
    client.initialize(&admin, &token_contract, &xlm_token);

    assert_eq!(client.admin(), admin);
    assert_eq!(client.token_contract(), token_contract);
    assert_eq!(client.global_dps(), 0i128);
    assert_eq!(client.total_distributed(), 0i128);
    assert_eq!(client.version(), soroban_sdk::String::from_str(&env, "1.0.0"));
    assert_eq!(client.status(), soroban_sdk::String::from_str(&env, "alive"));
}

#[test]
#[should_panic(expected = "already initialized")]
fn test_double_initialize() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let token_contract = Address::generate(&env);
    let xlm_token = create_xlm_token(&env, &admin);

    let contract_id = env.register_contract(None, DividendDistributor);
    let client = DividendDistributorClient::new(&env, &contract_id);

    client.initialize(&admin, &token_contract, &xlm_token);
    // Second call must panic.
    client.initialize(&admin, &token_contract, &xlm_token);
}

// ---------------------------------------------------------------------------
// Deposit Tests
// ---------------------------------------------------------------------------

#[test]
#[should_panic(expected = "amount must be positive")]
fn test_deposit_zero_amount() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let token_contract = Address::generate(&env);
    let xlm_id = create_xlm_token(&env, &admin);

    let contract_id = env.register_contract(None, DividendDistributor);
    let client = DividendDistributorClient::new(&env, &contract_id);
    client.initialize(&admin, &token_contract, &xlm_id);

    client.deposit(&admin, &0i128, &1_000_000i128);
}

#[test]
#[should_panic(expected = "no token supply")]
fn test_deposit_zero_supply() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let token_contract = Address::generate(&env);
    let xlm_id = create_xlm_token(&env, &admin);

    // Give admin some XLM so the transfer wouldn't fail for a different reason.
    mint_xlm(&env, &xlm_id, &admin, &admin, 1_000_000_000i128);

    let contract_id = env.register_contract(None, DividendDistributor);
    let client = DividendDistributorClient::new(&env, &contract_id);
    client.initialize(&admin, &token_contract, &xlm_id);

    // total_supply = 0 must panic before any XLM transfer happens.
    client.deposit(&admin, &100_000_000i128, &0i128);
}

#[test]
fn test_deposit_updates_dps_and_total() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let token_contract = Address::generate(&env);
    let xlm_id = create_xlm_token(&env, &admin);

    // Fund admin with XLM.
    mint_xlm(&env, &xlm_id, &admin, &admin, 1_000_000_000i128);

    let contract_id = env.register_contract(None, DividendDistributor);
    let client = DividendDistributorClient::new(&env, &contract_id);
    client.initialize(&admin, &token_contract, &xlm_id);

    let deposit_amount = 100_000_000i128; // 100 XLM in stroops
    let total_supply = 1_000_0000000i128; // 1000 tokens at 7 decimals

    client.deposit(&admin, &deposit_amount, &total_supply);

    // expected_dps = (deposit_amount * PRECISION) / total_supply
    //              = (100_000_000 * 10_000_000_000_000) / 10_000_000_000
    //              = 1_000_000_000_000_000_000_000 / 10_000_000_000
    //              = 100_000_000_000
    let precision: i128 = 10_000_000_000_000;
    let expected_dps = (deposit_amount * precision) / total_supply;

    assert_eq!(client.global_dps(), expected_dps);
    assert_eq!(client.total_distributed(), deposit_amount);
}

// ---------------------------------------------------------------------------
// Claim Tests
// ---------------------------------------------------------------------------

#[test]
fn test_claim_zero_when_nothing_deposited() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let holder = Address::generate(&env);
    let token_contract = Address::generate(&env);
    let xlm_id = create_xlm_token(&env, &admin);

    let contract_id = env.register_contract(None, DividendDistributor);
    let client = DividendDistributorClient::new(&env, &contract_id);
    client.initialize(&admin, &token_contract, &xlm_id);

    // No deposits made — claim should return 0 without panic.
    let claimed = client.claim(&holder, &500_0000000i128);
    assert_eq!(claimed, 0i128);
}

#[test]
fn test_single_holder_receives_all() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let holder = Address::generate(&env);
    let token_contract = Address::generate(&env);
    let xlm_id = create_xlm_token(&env, &admin);

    // Fund admin with XLM.
    mint_xlm(&env, &xlm_id, &admin, &admin, 1_000_000_000i128);

    let contract_id = env.register_contract(None, DividendDistributor);
    let client = DividendDistributorClient::new(&env, &contract_id);
    client.initialize(&admin, &token_contract, &xlm_id);

    // Holder owns 100% of supply.
    let total_supply = 1_000_0000000i128; // 1000 tokens at 7 decimals
    let holder_balance = total_supply;
    let deposit_amount = 100_000_000i128; // 100 XLM in stroops

    client.deposit(&admin, &deposit_amount, &total_supply);

    // Verify claimable view agrees.
    let claimable = client.claimable(&holder, &holder_balance);
    assert_eq!(claimable, deposit_amount);

    // Execute claim and verify XLM balance.
    let xlm_client = TokenClient::new(&env, &xlm_id);
    let before = xlm_client.balance(&holder);
    let claimed = client.claim(&holder, &holder_balance);

    assert_eq!(claimed, deposit_amount);
    assert_eq!(xlm_client.balance(&holder) - before, deposit_amount);

    // Claiming again immediately should yield 0.
    let claimed_again = client.claim(&holder, &holder_balance);
    assert_eq!(claimed_again, 0i128);
}

#[test]
fn test_proportional_distribution_70_30() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let holder_a = Address::generate(&env);
    let holder_b = Address::generate(&env);
    let token_contract = Address::generate(&env);
    let xlm_id = create_xlm_token(&env, &admin);

    // Fund issuer.
    mint_xlm(&env, &xlm_id, &admin, &admin, 1_000_000_000i128);

    let contract_id = env.register_contract(None, DividendDistributor);
    let client = DividendDistributorClient::new(&env, &contract_id);
    client.initialize(&admin, &token_contract, &xlm_id);

    // Holder A: 70%, Holder B: 30% of 1000 tokens.
    let total_supply = 1_000_0000000i128;
    let balance_a = 700_0000000i128; // 70%
    let balance_b = 300_0000000i128; // 30%
    let deposit_amount = 100_000_000i128; // 100 XLM

    client.deposit(&admin, &deposit_amount, &total_supply);

    // claimable_a = balance_a * dps_delta / PRECISION
    //             = 700_0000000 * (100_000_000 * 10^13 / 1000_0000000) / 10^13
    //             = 700_0000000 * 100_000_000 / 1000_0000000
    //             = 70_000_000  (70 XLM)
    let claimable_a = client.claimable(&holder_a, &balance_a);
    let claimable_b = client.claimable(&holder_b, &balance_b);

    assert_eq!(claimable_a, 70_000_000i128); // 70 XLM
    assert_eq!(claimable_b, 30_000_000i128); // 30 XLM
    // Totals must be exact — no precision loss for clean integer percentages.
    assert_eq!(claimable_a + claimable_b, deposit_amount);

    // Execute claims.
    let xlm_client = TokenClient::new(&env, &xlm_id);
    client.claim(&holder_a, &balance_a);
    client.claim(&holder_b, &balance_b);

    assert_eq!(xlm_client.balance(&holder_a), 70_000_000i128);
    assert_eq!(xlm_client.balance(&holder_b), 30_000_000i128);
}

#[test]
fn test_multiple_deposits_accumulate() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let holder = Address::generate(&env);
    let token_contract = Address::generate(&env);
    let xlm_id = create_xlm_token(&env, &admin);

    mint_xlm(&env, &xlm_id, &admin, &admin, 1_000_000_000i128);

    let contract_id = env.register_contract(None, DividendDistributor);
    let client = DividendDistributorClient::new(&env, &contract_id);
    client.initialize(&admin, &token_contract, &xlm_id);

    let total_supply = 1_000_0000000i128;
    let holder_balance = total_supply; // 100% holder

    // Three deposits of 10 XLM each = 30 XLM total.
    client.deposit(&admin, &10_000_000i128, &total_supply);
    client.deposit(&admin, &10_000_000i128, &total_supply);
    client.deposit(&admin, &10_000_000i128, &total_supply);

    assert_eq!(client.total_distributed(), 30_000_000i128);

    // Single claim should accumulate all three.
    let claimed = client.claim(&holder, &holder_balance);
    assert_eq!(claimed, 30_000_000i128);

    // Nothing left.
    let claimed_again = client.claim(&holder, &holder_balance);
    assert_eq!(claimed_again, 0i128);
}

#[test]
fn test_late_holder_only_claims_after_join() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let early_holder = Address::generate(&env);
    let late_holder = Address::generate(&env);
    let token_contract = Address::generate(&env);
    let xlm_id = create_xlm_token(&env, &admin);

    mint_xlm(&env, &xlm_id, &admin, &admin, 1_000_000_000i128);

    let contract_id = env.register_contract(None, DividendDistributor);
    let client = DividendDistributorClient::new(&env, &contract_id);
    client.initialize(&admin, &token_contract, &xlm_id);

    // Deposit 1: only early_holder holds tokens (500 tokens = total supply).
    let early_balance = 500_0000000i128;
    let total_supply_before = early_balance;
    client.deposit(&admin, &50_000_000i128, &total_supply_before);

    // late_holder "joins" — reset their debt pointer by calling claim(balance=0).
    // This records the current DPS as their starting point.
    client.claim(&late_holder, &0i128);

    // Deposit 2: both holders. Supply is now 1000 tokens (each holds 500).
    let late_balance = 500_0000000i128;
    let total_supply_after = 1_000_0000000i128;
    client.deposit(&admin, &100_000_000i128, &total_supply_after);

    // early_holder should claim both deposits:
    //   deposit 1: 100% of 50 XLM = 50 XLM (sole holder)
    //   deposit 2: 50% of 100 XLM = 50 XLM
    //   total = 100 XLM
    let early_claimable = client.claimable(&early_holder, &early_balance);
    assert_eq!(early_claimable, 100_000_000i128);

    // late_holder should only claim their share of deposit 2 (50%).
    let late_claimable = client.claimable(&late_holder, &late_balance);
    assert_eq!(late_claimable, 50_000_000i128);
}

#[test]
fn test_zero_balance_holder_claims_nothing() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let no_balance_user = Address::generate(&env);
    let token_contract = Address::generate(&env);
    let xlm_id = create_xlm_token(&env, &admin);

    mint_xlm(&env, &xlm_id, &admin, &admin, 1_000_000_000i128);

    let contract_id = env.register_contract(None, DividendDistributor);
    let client = DividendDistributorClient::new(&env, &contract_id);
    client.initialize(&admin, &token_contract, &xlm_id);

    client.deposit(&admin, &100_000_000i128, &1_000_0000000i128);

    // User has zero balance — should get nothing.
    let claimable = client.claimable(&no_balance_user, &0i128);
    assert_eq!(claimable, 0i128);

    let claimed = client.claim(&no_balance_user, &0i128);
    assert_eq!(claimed, 0i128);
}

#[test]
fn test_holder_debt_pointer_updated_after_claim() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let holder = Address::generate(&env);
    let token_contract = Address::generate(&env);
    let xlm_id = create_xlm_token(&env, &admin);

    mint_xlm(&env, &xlm_id, &admin, &admin, 1_000_000_000i128);

    let contract_id = env.register_contract(None, DividendDistributor);
    let client = DividendDistributorClient::new(&env, &contract_id);
    client.initialize(&admin, &token_contract, &xlm_id);

    let total_supply = 1_000_0000000i128;
    let holder_balance = total_supply;

    // Initial debt pointer should be 0 (no entry yet).
    assert_eq!(client.holder_debt(&holder), 0i128);

    client.deposit(&admin, &100_000_000i128, &total_supply);
    client.claim(&holder, &holder_balance);

    // After claim, debt pointer must equal the current global DPS.
    assert_eq!(client.holder_debt(&holder), client.global_dps());
}
