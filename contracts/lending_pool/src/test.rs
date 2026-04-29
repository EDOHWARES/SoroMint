#![cfg(test)]

use super::*;
use soroban_sdk::{testutils::{Address as _, Events}, Address, Env, String};
use soroban_sdk::token::{Client as TokenClient, StellarAssetClient};
use crate::oracle::OracleInterface;

#[contract]
pub struct MockOracle;

#[contractimpl]
impl OracleInterface for MockOracle {
    fn get_price(_e: Env, _asset: Address) -> i128 {
        10_000_000 // 1:1 price for simplicity (1 asset = 1 SMT)
    }
}

fn create_token<'a>(e: &'a Env, admin: &Address) -> (TokenClient<'a>, StellarAssetClient<'a>) {
    let address = e.register_stellar_asset_contract(admin.clone());
    (TokenClient::new(e, &address), StellarAssetClient::new(e, &address))
}

#[test]
fn test_lending_flow() {
    let e = Env::default();
    e.mock_all_auths();

    let admin = Address::generate(&e);
    let user = Address::generate(&e);
    let liquidator = Address::generate(&e);

    // Deploy SMT Token (Mocking with Stellar Asset for simplicity in test)
    let (smt_token, smt_admin) = create_token(&e, &admin);
    
    // Deploy Collateral Token
    let (coll_token, coll_admin) = create_token(&e, &admin);
    
    // Deploy Oracle
    let oracle_addr = e.register_contract(None, MockOracle);
    
    // Deploy Lending Pool
    let pool_addr = e.register_contract(None, LendingPool);
    let pool = LendingPoolClient::new(&e, &pool_addr);
    
    pool.initialize(&admin, &smt_token.address, &oracle_addr);
    
    // Configure Asset
    let asset_config = AssetConfig {
        ltv_bps: 8000,             // 80%
        liquidation_threshold: 9000, // 90%
        liquidation_bonus: 500,     // 5%
        is_active: true,
    };
    pool.set_asset_config(&coll_token.address, &asset_config);
    
    // Mint collateral to user
    coll_admin.mint(&user, &1000_0000000);
    
    // Deposit collateral
    pool.deposit(&user, &coll_token.address, &1000_0000000);
    
    assert_eq!(coll_token.balance(&user), 0);
    assert_eq!(coll_token.balance(&pool_addr), 1000_0000000);
    
    // Borrow SMT
    // Pool needs SMT to lend
    smt_admin.mint(&pool_addr, &1000_0000000);
    
    pool.borrow(&user, &700_0000000); // 70% LTV, should pass
    
    assert_eq!(smt_token.balance(&user), 700_0000000);
    
    // Try to borrow more than LTV
    // Max borrow = 1000 * 0.8 = 800. User already borrowed 700. Can borrow 100 more.
    // Let's try to borrow 200 more.
    let result = pool.try_borrow(&user, &200_0000000);
    assert!(result.is_err());
    
    // Repay
    pool.repay(&user, &200_0000000);
    assert_eq!(smt_token.balance(&user), 500_0000000);
    
    // Withdraw
    pool.withdraw(&user, &coll_token.address, &100_0000000);
    assert_eq!(coll_token.balance(&user), 100_0000000);
}

#[test]
fn test_liquidation() {
    let e = Env::default();
    e.mock_all_auths();

    let admin = Address::generate(&e);
    let user = Address::generate(&e);
    let liquidator = Address::generate(&e);

    let (smt_token, smt_admin) = create_token(&e, &admin);
    let (coll_token, coll_admin) = create_token(&e, &admin);
    let oracle_addr = e.register_contract(None, MockOracle);
    let pool_addr = e.register_contract(None, LendingPool);
    let pool = LendingPoolClient::new(&e, &pool_addr);
    
    pool.initialize(&admin, &smt_token.address, &oracle_addr);
    
    let asset_config = AssetConfig {
        ltv_bps: 8000,
        liquidation_threshold: 9000,
        liquidation_bonus: 1000, // 10% bonus
        is_active: true,
    };
    pool.set_asset_config(&coll_token.address, &asset_config);
    
    coll_admin.mint(&user, &1000_0000000);
    pool.deposit(&user, &coll_token.address, &1000_0000000);
    
    smt_admin.mint(&pool_addr, &1000_0000000);
    pool.borrow(&user, &800_0000000); // Max LTV
    
    // Now imagine the price drops or threshold changes.
    // For simplicity, let's change the asset config to make it liquidatable.
    let new_config = AssetConfig {
        ltv_bps: 5000,
        liquidation_threshold: 7000, // Now user is at 80% debt but threshold is 70%
        liquidation_bonus: 1000,
        is_active: true,
    };
    pool.set_asset_config(&coll_token.address, &new_config);
    
    assert!(!pool.is_healthy(&user));
    
    // Liquidator covers 400 debt
    smt_admin.mint(&liquidator, &400_0000000);
    pool.liquidate(&liquidator, &user, &coll_token.address, &400_0000000);
    
    // Collateral given = (repay_amount / price) * (1 + bonus)
    // = (400 / 1) * 1.1 = 440
    assert_eq!(coll_token.balance(&liquidator), 440_0000000);
    assert_eq!(smt_token.balance(&liquidator), 0);
}
