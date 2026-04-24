#![no_std]

mod types;
mod oracle;
mod events;

#[cfg(test)]
mod test;

use soroban_sdk::{contract, contractimpl, token, Address, Env, Vec};
use types::{AssetConfig, DataKey};
use oracle::OracleClient;

#[contract]
pub struct LendingPool;

#[contractimpl]
impl LendingPool {
    pub fn initialize(e: Env, admin: Address, smt_token: Address, oracle: Address) {
        if e.storage().instance().has(&DataKey::Admin) {
            panic!("already initialized");
        }
        e.storage().instance().set(&DataKey::Admin, &admin);
        e.storage().instance().set(&DataKey::SmtToken, &smt_token);
        e.storage().instance().set(&DataKey::Oracle, &oracle);
    }

    pub fn set_asset_config(e: Env, asset: Address, config: AssetConfig) {
        let admin: Address = e.storage().instance().get(&DataKey::Admin).unwrap();
        admin.require_auth();
        
        if !e.storage().instance().has(&DataKey::AssetConfig(asset.clone())) {
            let mut assets: Vec<Address> = e.storage().instance().get(&DataKey::Assets).unwrap_or(Vec::new(&e));
            assets.push_back(asset.clone());
            e.storage().instance().set(&DataKey::Assets, &assets);
        }

        e.storage().instance().set(&DataKey::AssetConfig(asset), &config);
    }

    pub fn deposit(e: Env, user: Address, asset: Address, amount: i128) {
        user.require_auth();
        if amount <= 0 { panic!("amount must be positive"); }

        let config: AssetConfig = e.storage().instance().get(&DataKey::AssetConfig(asset.clone())).expect("asset not supported");
        if !config.is_active { panic!("asset not active"); }

        // Transfer asset to pool
        let client = token::Client::new(&e, &asset);
        client.transfer(&user, &e.current_contract_address(), &amount);

        // Update storage
        let key = DataKey::UserCollateral(user.clone(), asset.clone());
        let current: i128 = e.storage().persistent().get(&key).unwrap_or(0);
        e.storage().persistent().set(&key, &(current + amount));

        events::emit_deposit(&e, &user, &asset, amount);
    }

    pub fn withdraw(e: Env, user: Address, asset: Address, amount: i128) {
        user.require_auth();
        if amount <= 0 { panic!("amount must be positive"); }

        let key = DataKey::UserCollateral(user.clone(), asset.clone());
        let current: i128 = e.storage().persistent().get(&key).unwrap_or(0);
        if current < amount { panic!("insufficient collateral"); }

        // Check health after withdrawal
        let new_collateral = current - amount;
        e.storage().persistent().set(&key, &new_collateral);

        if !Self::is_healthy(e.clone(), user.clone()) {
            panic!("withdrawal would lead to under-collateralization");
        }

        // Transfer asset to user
        let client = token::Client::new(&e, &asset);
        client.transfer(&e.current_contract_address(), &user, &amount);

        events::emit_withdraw(&e, &user, &asset, amount);
    }

    pub fn borrow(e: Env, user: Address, amount: i128) {
        user.require_auth();
        if amount <= 0 { panic!("amount must be positive"); }

        let smt_token: Address = e.storage().instance().get(&DataKey::SmtToken).unwrap();
        
        let debt_key = DataKey::UserDebt(user.clone());
        let current_debt: i128 = e.storage().persistent().get(&debt_key).unwrap_or(0);

        // Check borrow power
        let total_borrow_power = Self::get_account_collateral_value(e.clone(), user.clone(), false);
        if current_debt + amount > total_borrow_power {
            panic!("insufficient collateral for borrow");
        }

        // Update debt
        e.storage().persistent().set(&debt_key, &(current_debt + amount));

        // Transfer/Mint SMT to user
        // For this implementation, we assume the pool has SMT or can mint it.
        // We'll use transfer for now, assuming the pool is funded.
        let client = token::Client::new(&e, &smt_token);
        client.transfer(&e.current_contract_address(), &user, &amount);

        events::emit_borrow(&e, &user, amount);
    }

    pub fn repay(e: Env, user: Address, amount: i128) {
        user.require_auth();
        if amount <= 0 { panic!("amount must be positive"); }

        let smt_token: Address = e.storage().instance().get(&DataKey::SmtToken).unwrap();
        let debt_key = DataKey::UserDebt(user.clone());
        let current_debt: i128 = e.storage().persistent().get(&debt_key).unwrap_or(0);
        
        let repay_amount = if amount > current_debt { current_debt } else { amount };

        // Transfer SMT from user to pool
        let client = token::Client::new(&e, &smt_token);
        client.transfer(&user, &e.current_contract_address(), &repay_amount);

        // Update storage
        e.storage().persistent().set(&debt_key, &(current_debt - repay_amount));

        events::emit_repay(&e, &user, repay_amount);
    }

    pub fn liquidate(e: Env, liquidator: Address, borrower: Address, asset: Address, amount: i128) {
        liquidator.require_auth();
        if amount <= 0 { panic!("amount must be positive"); }

        if Self::is_healthy(e.clone(), borrower.clone()) {
            panic!("borrower is healthy");
        }

        let smt_token: Address = e.storage().instance().get(&DataKey::SmtToken).unwrap();
        let debt_key = DataKey::UserDebt(borrower.clone());
        let current_debt: i128 = e.storage().persistent().get(&debt_key).unwrap_or(0);
        
        let repay_amount = if amount > current_debt { current_debt } else { amount };

        // Liquidator pays debt in SMT
        let smt_client = token::Client::new(&e, &smt_token);
        smt_client.transfer(&liquidator, &e.current_contract_address(), &repay_amount);
        e.storage().persistent().set(&debt_key, &(current_debt - repay_amount));

        // Calculate collateral to give to liquidator
        let oracle_addr: Address = e.storage().instance().get(&DataKey::Oracle).unwrap();
        let oracle = OracleClient::new(&e, &oracle_addr);
        let price = oracle.get_price(&asset); // Price of asset in SMT

        let config: AssetConfig = e.storage().instance().get(&DataKey::AssetConfig(asset.clone())).unwrap();
        
        // value_of_repay_in_asset = repay_amount / price
        // collateral_to_give = value_of_repay_in_asset * (1 + bonus)
        // Using fixed point math (7 decimals for price/smt)
        let collateral_to_give = (repay_amount * 10_000_000 / price) * (10000 + config.liquidation_bonus as i128) / 10000;

        let coll_key = DataKey::UserCollateral(borrower.clone(), asset.clone());
        let borrower_coll: i128 = e.storage().persistent().get(&coll_key).unwrap_or(0);
        
        let actual_give = if collateral_to_give > borrower_coll { borrower_coll } else { collateral_to_give };
        e.storage().persistent().set(&coll_key, &(borrower_coll - actual_give));

        // Transfer collateral to liquidator
        let asset_client = token::Client::new(&e, &asset);
        asset_client.transfer(&e.current_contract_address(), &liquidator, &actual_give);

        events::emit_liquidate(&e, &liquidator, &borrower, &asset, actual_give);
    }

    pub fn is_healthy(e: Env, user: Address) -> bool {
        let debt: i128 = e.storage().persistent().get(&DataKey::UserDebt(user.clone())).unwrap_or(0);
        if debt == 0 { return true; }

        let total_collateral_value = Self::get_account_collateral_value(e, user, true);
        total_collateral_value >= debt
    }

    pub fn get_account_collateral_value(e: Env, user: Address, use_threshold: bool) -> i128 {
        let oracle_addr: Address = e.storage().instance().get(&DataKey::Oracle).unwrap();
        let oracle = OracleClient::new(&e, &oracle_addr);
        
        let assets: Vec<Address> = e.storage().instance().get(&DataKey::Assets).unwrap_or(Vec::new(&e));
        let mut total_value: i128 = 0;

        for asset in assets.iter() {
            let coll_key = DataKey::UserCollateral(user.clone(), asset.clone());
            let amount: i128 = e.storage().persistent().get(&coll_key).unwrap_or(0);
            if amount > 0 {
                let price = oracle.get_price(&asset);
                let config: AssetConfig = e.storage().instance().get(&DataKey::AssetConfig(asset)).unwrap();
                
                let value = (amount * price) / 10_000_000; // Base 7 decimals
                let adjusted_value = if use_threshold {
                    (value * config.liquidation_threshold as i128) / 10000
                } else {
                    (value * config.ltv_bps as i128) / 10000
                };
                total_value += adjusted_value;
            }
        }
        total_value
    }
}
