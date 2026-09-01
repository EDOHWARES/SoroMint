#![cfg(test)]

use super::*;
use soroban_sdk::{contract, contractimpl, contracttype, testutils::Address as _, Address, Env};

#[contracttype]
enum FeedKey {
    Price(Address),
    HasTwap(Address),
}

#[contract]
pub struct MockPriceFeed;

#[contractimpl]
impl MockPriceFeed {
    pub fn set_price(e: Env, token: Address, price: i128) {
        e.storage()
            .persistent()
            .set(&FeedKey::Price(token.clone()), &price);
        e.storage()
            .persistent()
            .set(&FeedKey::HasTwap(token), &true);
    }

    pub fn set_has_twap(e: Env, token: Address, ready: bool) {
        e.storage()
            .persistent()
            .set(&FeedKey::HasTwap(token), &ready);
    }

    pub fn get_price(e: Env, token: Address) -> i128 {
        e.storage()
            .persistent()
            .get(&FeedKey::Price(token))
            .expect("price not found")
    }

    pub fn has_twap(e: Env, token: Address) -> bool {
        e.storage()
            .persistent()
            .get(&FeedKey::HasTwap(token))
            .unwrap_or(false)
    }
}

#[contract]
pub struct MockToken;

#[contractimpl]
impl MockToken {
    pub fn mint(e: Env, to: Address, amount: i128) {
        let bal: i128 = e.storage().persistent().get(&to).unwrap_or(0);
        e.storage().persistent().set(&to, &(bal + amount));
    }

    pub fn burn(e: Env, from: Address, amount: i128) {
        let bal: i128 = e.storage().persistent().get(&from).unwrap_or(0);
        e.storage().persistent().set(&from, &(bal - amount));
    }

    pub fn transfer(e: Env, from: Address, to: Address, amount: i128) {
        let from_bal: i128 = e.storage().persistent().get(&from).unwrap_or(0);
        let to_bal: i128 = e.storage().persistent().get(&to).unwrap_or(0);
        if from_bal < amount {
            panic!("insufficient balance");
        }
        e.storage().persistent().set(&from, &(from_bal - amount));
        e.storage().persistent().set(&to, &(to_bal + amount));
    }
}

#[test]
fn test_initialize() {
    let env = Env::default();
    let contract_id = env.register_contract(None, VaultContract);
    let client = VaultContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let smt_token = Address::generate(&env);
    let oracle = Address::generate(&env);

    client.initialize(&admin, &smt_token, &oracle);
    let cfg = client.get_twap_config();
    assert!(!cfg.configured);
    assert!(!cfg.liquidations_paused);
    assert_eq!(cfg.divergence_threshold_bps, 500);
}

#[test]
fn test_add_collateral_config() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register_contract(None, VaultContract);
    let client = VaultContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let smt_token = Address::generate(&env);
    let oracle = Address::generate(&env);
    let collateral = Address::generate(&env);

    client.initialize(&admin, &smt_token, &oracle);
    client.set_collateral_config(&collateral, &15000, &13000, &1000);
}

#[test]
fn test_vault_health_calculation() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register_contract(None, VaultContract);
    let client = VaultContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let smt_token = Address::generate(&env);
    let oracle = Address::generate(&env);

    client.initialize(&admin, &smt_token, &oracle);
}

#[test]
#[should_panic(expected = "reentrancy detected")]
fn test_reentrancy_guard_panics_on_double_lock() {
    let env = Env::default();
    let contract_id = env.register_contract(None, VaultContract);
    env.as_contract(&contract_id, || {
        let _guard1 = reentrancy::ReentrancyGuard::lock(&env, "test_func");
        let _guard2 = reentrancy::ReentrancyGuard::lock(&env, "test_func");
    });
}

#[test]
fn test_reentrancy_guard_unlocks_on_drop() {
    let env = Env::default();
    let contract_id = env.register_contract(None, VaultContract);
    env.as_contract(&contract_id, || {
        {
            let _guard = reentrancy::ReentrancyGuard::lock(&env, "test_func");
        }
        let _guard2 = reentrancy::ReentrancyGuard::lock(&env, "test_func");
    });
}

fn setup_vault_with_feeds() -> (
    Env,
    VaultContractClient<'static>,
    MockPriceFeedClient<'static>,
    MockPriceFeedClient<'static>,
    MockTokenClient<'static>,
    Address,
    Address,
    Address,
) {
    let env = Env::default();
    env.mock_all_auths();

    let push_id = env.register(MockPriceFeed, ());
    let twap_id = env.register(MockPriceFeed, ());
    let smt_id = env.register(MockToken, ());
    let collateral_id = env.register(MockToken, ());
    let vault_id = env.register(VaultContract, ());

    let push = MockPriceFeedClient::new(&env, &push_id);
    let twap = MockPriceFeedClient::new(&env, &twap_id);
    let smt = MockTokenClient::new(&env, &smt_id);
    let vault = VaultContractClient::new(&env, &vault_id);
    let admin = Address::generate(&env);

    vault.initialize(&admin, &smt_id, &push_id);
    vault.set_collateral_config(&collateral_id, &15000, &13000, &1000);
    vault.set_twap_oracle(&twap_id, &500u32);

    (env, vault, push, twap, smt, admin, collateral_id, vault_id)
}

fn open_liquidatable_vault(
    env: &Env,
    vault: &VaultContractClient,
    push: &MockPriceFeedClient,
    smt: &MockTokenClient,
    collateral_id: &Address,
) -> (u64, Address, Address) {
    let user = Address::generate(env);
    let liquidator = Address::generate(env);
    let collateral = MockTokenClient::new(env, collateral_id);

    push.set_price(collateral_id, &1_0000000);
    collateral.mint(&user, &150_0000000);
    let id = vault.deposit_and_mint(&user, collateral_id, &150_0000000, &100_0000000);

    push.set_price(collateral_id, &8000000);
    smt.mint(&liquidator, &50_0000000);
    (id, user, liquidator)
}

#[test]
fn test_set_twap_oracle_config() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(VaultContract, ());
    let client = VaultContractClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let smt_token = Address::generate(&env);
    let oracle = Address::generate(&env);
    let twap = Address::generate(&env);

    client.initialize(&admin, &smt_token, &oracle);
    client.set_twap_oracle(&twap, &250u32);

    let cfg = client.get_twap_config();
    assert!(cfg.configured);
    assert_eq!(cfg.twap_oracle, twap);
    assert_eq!(cfg.divergence_threshold_bps, 250);
}

#[test]
#[should_panic(expected = "liquidations paused")]
fn test_admin_pause_blocks_liquidation() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(VaultContract, ());
    let client = VaultContractClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    client.initialize(&admin, &Address::generate(&env), &Address::generate(&env));
    client.set_liquidations_paused(&true);

    client.liquidate(&1u64, &Address::generate(&env), &1i128);
}

#[test]
#[should_panic(expected = "oracle divergence")]
fn test_liquidate_reverts_when_push_oracle_diverges_from_twap() {
    let (env, vault, push, twap, smt, _admin, collateral_id, _vault_addr) =
        setup_vault_with_feeds();
    let (id, _user, liquidator) =
        open_liquidatable_vault(&env, &vault, &push, &smt, &collateral_id);

    twap.set_price(&collateral_id, &1_0000000);

    vault.liquidate(&id, &liquidator, &50_0000000);
}

#[test]
fn test_trip_circuit_breaker_pauses_liquidations() {
    let (env, vault, push, twap, smt, _admin, collateral_id, _vault_addr) =
        setup_vault_with_feeds();
    let (id, _user, liquidator) =
        open_liquidatable_vault(&env, &vault, &push, &smt, &collateral_id);

    twap.set_price(&collateral_id, &1_0000000);
    assert!(vault.is_oracle_diverged(&collateral_id));

    vault.trip_oracle_circuit_breaker(&collateral_id);
    assert!(vault.liquidations_paused());

    let result = vault.try_liquidate(&id, &liquidator, &50_0000000);
    assert!(result.is_err());
}

#[test]
fn test_aligned_oracles_allow_liquidation() {
    let (env, vault, push, twap, smt, _admin, collateral_id, _vault_addr) =
        setup_vault_with_feeds();
    let (id, _user, liquidator) =
        open_liquidatable_vault(&env, &vault, &push, &smt, &collateral_id);

    twap.set_price(&collateral_id, &8000000);
    assert!(!vault.is_oracle_diverged(&collateral_id));

    vault.liquidate(&id, &liquidator, &50_0000000);
    let position = vault.get_vault(&id);
    assert_eq!(position.debt, 50_0000000);
}

