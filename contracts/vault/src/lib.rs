#![no_std]

mod storage;
mod oracle;
mod liquidation;
mod events;

#[cfg(test)]
mod test;

use soroban_sdk::{contract, contractimpl, contracttype, Address, Env, String, Vec, Map};
use storage::{DataKey, VaultPosition, CollateralConfig};
use oracle::PriceOracle;

/// Minimum collateralization ratio (150% = 15000 basis points)
const MIN_COLLATERAL_RATIO: u32 = 15000;
/// Liquidation threshold (130% = 13000 basis points)
const LIQUIDATION_THRESHOLD: u32 = 13000;
/// Liquidation penalty (10% = 1000 basis points)
const LIQUIDATION_PENALTY: u32 = 1000;
/// Basis points divisor
const BP_DIVISOR: u32 = 10000;

#[contract]
pub struct VaultContract;

#[contractimpl]
impl VaultContract {
    /// Initialize the vault with admin and SMT token address
    pub fn initialize(
        e: Env,
        admin: Address,
        smt_token: Address,
        oracle: Address,
    ) {
        if e.storage().instance().has(&DataKey::Admin) {
            panic!("already initialized");
        }
        
        e.storage().instance().set(&DataKey::Admin, &admin);
        e.storage().instance().set(&DataKey::SmtToken, &smt_token);
        e.storage().instance().set(&DataKey::Oracle, &oracle);
        e.storage().instance().set(&DataKey::VaultCounter, &0u64);
        
        events::emit_initialized(&e, &admin, &smt_token, &oracle);
    }

    /// Add a supported collateral token with configuration
    pub fn add_collateral(
        e: Env,
        collateral_token: Address,
        min_collateral_ratio: u32,
        liquidation_threshold: u32,
        liquidation_penalty: u32,
    ) {
        let admin: Address = e.storage().instance().get(&DataKey::Admin).unwrap();
        admin.require_auth();

        if min_collateral_ratio < MIN_COLLATERAL_RATIO {
            panic!("collateral ratio too low");
        }
        if liquidation_threshold >= min_collateral_ratio {
            panic!("liquidation threshold must be below min ratio");
        }

        let config = CollateralConfig {
            enabled: true,
            min_collateral_ratio,
            liquidation_threshold,
            liquidation_penalty,
        };

        e.storage().persistent().set(
            &DataKey::CollateralConfig(collateral_token.clone()),
            &config
        );

        events::emit_collateral_added(&e, &collateral_token, &config);
    }

    /// Deposit collateral and mint SMT
    pub fn deposit_and_mint(
        e: Env,
        user: Address,
        collateral_token: Address,
        collateral_amount: i128,
        smt_amount: i128,
    ) -> u64 {
        user.require_auth();

        if collateral_amount <= 0 || smt_amount <= 0 {
            panic!("amounts must be positive");
        }

        // Verify collateral is supported
        let config: CollateralConfig = e.storage().persistent()
            .get(&DataKey::CollateralConfig(collateral_token.clone()))
            .expect("collateral not supported");

        if !config.enabled {
            panic!("collateral disabled");
        }

        // Get prices from oracle
        let oracle_addr: Address = e.storage().instance().get(&DataKey::Oracle).unwrap();
        let collateral_price = oracle::get_price(&e, &oracle_addr, &collateral_token);
        let smt_price = 1_0000000i128; // SMT pegged to $1 with 7 decimals

        // Calculate collateral value in USD
        let collateral_value = (collateral_amount * collateral_price) / 1_0000000;
        let debt_value = (smt_amount * smt_price) / 1_0000000;

        // Check collateralization ratio
        let ratio = (collateral_value * BP_DIVISOR as i128) / debt_value;
        if ratio < config.min_collateral_ratio as i128 {
            panic!("insufficient collateral ratio");
        }

        // Transfer collateral from user to vault
        Self::transfer_token(&e, &collateral_token, &user, &e.current_contract_address(), collateral_amount);

        // Create vault position
        let vault_id = Self::next_vault_id(&e);
        let mut collaterals = Map::new(&e);
        collaterals.set(collateral_token.clone(), collateral_amount);

        let position = VaultPosition {
            owner: user.clone(),
            collaterals,
            debt: smt_amount,
            created_at: e.ledger().timestamp(),
        };

        e.storage().persistent().set(&DataKey::Vault(vault_id), &position);
        
        // Track user's vaults
        let mut user_vaults: Vec<u64> = e.storage().persistent()
            .get(&DataKey::UserVaults(user.clone()))
            .unwrap_or(Vec::new(&e));
        user_vaults.push_back(vault_id);
        e.storage().persistent().set(&DataKey::UserVaults(user.clone()), &user_vaults);

        // Mint SMT to user
        let smt_token: Address = e.storage().instance().get(&DataKey::SmtToken).unwrap();
        Self::mint_smt(&e, &smt_token, &user, smt_amount);

        events::emit_vault_created(&e, vault_id, &user, &collateral_token, collateral_amount, smt_amount);

        vault_id
    }

    /// Add more collateral to existing vault
    pub fn add_collateral(
        e: Env,
        vault_id: u64,
        collateral_token: Address,
        amount: i128,
    ) {
        let mut position: VaultPosition = e.storage().persistent()
            .get(&DataKey::Vault(vault_id))
            .expect("vault not found");

        position.owner.require_auth();

        if amount <= 0 {
            panic!("amount must be positive");
        }

        // Verify collateral is supported
        let config: CollateralConfig = e.storage().persistent()
            .get(&DataKey::CollateralConfig(collateral_token.clone()))
            .expect("collateral not supported");

        if !config.enabled {
            panic!("collateral disabled");
        }

        // Transfer collateral from user to vault
        Self::transfer_token(&e, &collateral_token, &position.owner, &e.current_contract_address(), amount);

        // Update vault position
        let current = position.collaterals.get(collateral_token.clone()).unwrap_or(0);
        position.collaterals.set(collateral_token.clone(), current + amount);
        e.storage().persistent().set(&DataKey::Vault(vault_id), &position);

        events::emit_collateral_added_to_vault(&e, vault_id, &collateral_token, amount);
    }

    /// Mint additional SMT against existing collateral
    pub fn mint_more(
        e: Env,
        vault_id: u64,
        smt_amount: i128,
    ) {
        let mut position: VaultPosition = e.storage().persistent()
            .get(&DataKey::Vault(vault_id))
            .expect("vault not found");

        position.owner.require_auth();

        if smt_amount <= 0 {
            panic!("amount must be positive");
        }

        let new_debt = position.debt + smt_amount;

        // Check if vault remains healthy
        Self::require_healthy_vault(&e, &position.collaterals, new_debt);

        position.debt = new_debt;
        e.storage().persistent().set(&DataKey::Vault(vault_id), &position);

        // Mint SMT to user
        let smt_token: Address = e.storage().instance().get(&DataKey::SmtToken).unwrap();
        Self::mint_smt(&e, &smt_token, &position.owner, smt_amount);

        events::emit_smt_minted(&e, vault_id, smt_amount, new_debt);
    }

    /// Repay debt and optionally withdraw collateral
    pub fn repay_and_withdraw(
        e: Env,
        vault_id: u64,
        repay_amount: i128,
        collateral_token: Address,
        withdraw_amount: i128,
    ) {
        let mut position: VaultPosition = e.storage().persistent()
            .get(&DataKey::Vault(vault_id))
            .expect("vault not found");

        position.owner.require_auth();

        if repay_amount < 0 || withdraw_amount < 0 {
            panic!("amounts cannot be negative");
        }

        // Burn SMT from user
        if repay_amount > 0 {
            let smt_token: Address = e.storage().instance().get(&DataKey::SmtToken).unwrap();
            Self::burn_smt(&e, &smt_token, &position.owner, repay_amount);
            position.debt -= repay_amount;
        }

        // Withdraw collateral
        if withdraw_amount > 0 {
            let current = position.collaterals.get(collateral_token.clone()).unwrap_or(0);
            if withdraw_amount > current {
                panic!("insufficient collateral");
            }

            position.collaterals.set(collateral_token.clone(), current - withdraw_amount);

            // Check if vault remains healthy (if debt > 0)
            if position.debt > 0 {
                Self::require_healthy_vault(&e, &position.collaterals, position.debt);
            }

            // Transfer collateral back to user
            Self::transfer_token(&e, &collateral_token, &e.current_contract_address(), &position.owner, withdraw_amount);
        }

        e.storage().persistent().set(&DataKey::Vault(vault_id), &position);

        events::emit_repay_and_withdraw(&e, vault_id, repay_amount, &collateral_token, withdraw_amount);
    }

    /// Liquidate an undercollateralized vault
    pub fn liquidate(
        e: Env,
        vault_id: u64,
        liquidator: Address,
        debt_to_cover: i128,
    ) {
        liquidator.require_auth();

        let mut position: VaultPosition = e.storage().persistent()
            .get(&DataKey::Vault(vault_id))
            .expect("vault not found");

        if debt_to_cover <= 0 || debt_to_cover > position.debt {
            panic!("invalid debt amount");
        }

        // Check if vault is liquidatable
        let (is_liquidatable, ratio) = Self::check_liquidation(&e, &position);
        if !is_liquidatable {
            panic!("vault is healthy");
        }

        // Calculate collateral to seize (with penalty)
        let oracle_addr: Address = e.storage().instance().get(&DataKey::Oracle).unwrap();
        let smt_price = 1_0000000i128;
        let debt_value = (debt_to_cover * smt_price) / 1_0000000;

        // Burn SMT from liquidator
        let smt_token: Address = e.storage().instance().get(&DataKey::SmtToken).unwrap();
        Self::burn_smt(&e, &smt_token, &liquidator, debt_to_cover);

        // Seize collateral proportionally with penalty
        let mut total_seized_value = 0i128;
        for (token, amount) in position.collaterals.iter() {
            let price = oracle::get_price(&e, &oracle_addr, &token);
            let value = (amount * price) / 1_0000000;
            
            // Calculate proportion to seize
            let collateral_ratio = (value * BP_DIVISOR as i128) / Self::get_total_collateral_value(&e, &position.collaterals);
            let debt_share = (debt_value * collateral_ratio) / BP_DIVISOR as i128;
            
            // Add liquidation penalty
            let config: CollateralConfig = e.storage().persistent()
                .get(&DataKey::CollateralConfig(token.clone()))
                .unwrap();
            let penalty_multiplier = BP_DIVISOR + config.liquidation_penalty;
            let amount_to_seize = (debt_share * 1_0000000 * penalty_multiplier as i128) / (price * BP_DIVISOR as i128);

            if amount_to_seize > 0 && amount_to_seize <= amount {
                // Transfer collateral to liquidator
                Self::transfer_token(&e, &token, &e.current_contract_address(), &liquidator, amount_to_seize);
                
                // Update vault collateral
                position.collaterals.set(token.clone(), amount - amount_to_seize);
                total_seized_value += (amount_to_seize * price) / 1_0000000;
            }
        }

        // Update vault debt
        position.debt -= debt_to_cover;
        e.storage().persistent().set(&DataKey::Vault(vault_id), &position);

        events::emit_liquidation(&e, vault_id, &liquidator, debt_to_cover, total_seized_value);
    }

    /// Get vault position details
    pub fn get_vault(e: Env, vault_id: u64) -> VaultPosition {
        e.storage().persistent()
            .get(&DataKey::Vault(vault_id))
            .expect("vault not found")
    }

    /// Get user's vault IDs
    pub fn get_user_vaults(e: Env, user: Address) -> Vec<u64> {
        e.storage().persistent()
            .get(&DataKey::UserVaults(user))
            .unwrap_or(Vec::new(&e))
    }

    /// Get vault health (collateralization ratio)
    pub fn get_vault_health(e: Env, vault_id: u64) -> i128 {
        let position: VaultPosition = e.storage().persistent()
            .get(&DataKey::Vault(vault_id))
            .expect("vault not found");

        if position.debt == 0 {
            return i128::MAX;
        }

        let collateral_value = Self::get_total_collateral_value(&e, &position.collaterals);
        let smt_price = 1_0000000i128;
        let debt_value = (position.debt * smt_price) / 1_0000000;

        (collateral_value * BP_DIVISOR as i128) / debt_value
    }

    /// Check if vault can be liquidated
    pub fn is_liquidatable(e: Env, vault_id: u64) -> bool {
        let position: VaultPosition = e.storage().persistent()
            .get(&DataKey::Vault(vault_id))
            .expect("vault not found");

        let (liquidatable, _) = Self::check_liquidation(&e, &position);
        liquidatable
    }

    // Internal helper functions

    fn next_vault_id(e: &Env) -> u64 {
        let current: u64 = e.storage().instance().get(&DataKey::VaultCounter).unwrap();
        let next = current + 1;
        e.storage().instance().set(&DataKey::VaultCounter, &next);
        next
    }

    fn transfer_token(e: &Env, token: &Address, from: &Address, to: &Address, amount: i128) {
        use soroban_sdk::{IntoVal, Symbol};
        let args = soroban_sdk::vec![
            e,
            from.into_val(e),
            to.into_val(e),
            amount.into_val(e),
        ];
        e.invoke_contract::<()>(token, &Symbol::new(e, "transfer"), args);
    }

    fn mint_smt(e: &Env, smt_token: &Address, to: &Address, amount: i128) {
        use soroban_sdk::{IntoVal, Symbol};
        let args = soroban_sdk::vec![e, to.into_val(e), amount.into_val(e)];
        e.invoke_contract::<()>(smt_token, &Symbol::new(e, "mint"), args);
    }

    fn burn_smt(e: &Env, smt_token: &Address, from: &Address, amount: i128) {
        use soroban_sdk::{IntoVal, Symbol};
        let args = soroban_sdk::vec![e, from.into_val(e), amount.into_val(e)];
        e.invoke_contract::<()>(smt_token, &Symbol::new(e, "burn"), args);
    }

    fn get_total_collateral_value(e: &Env, collaterals: &Map<Address, i128>) -> i128 {
        let oracle_addr: Address = e.storage().instance().get(&DataKey::Oracle).unwrap();
        let mut total = 0i128;

        for (token, amount) in collaterals.iter() {
            let price = oracle::get_price(e, &oracle_addr, &token);
            total += (amount * price) / 1_0000000;
        }

        total
    }

    fn require_healthy_vault(e: &Env, collaterals: &Map<Address, i128>, debt: i128) {
        let collateral_value = Self::get_total_collateral_value(e, collaterals);
        let smt_price = 1_0000000i128;
        let debt_value = (debt * smt_price) / 1_0000000;

        let ratio = (collateral_value * BP_DIVISOR as i128) / debt_value;

        // Check against the strictest min collateral ratio
        let mut min_ratio = MIN_COLLATERAL_RATIO;
        for (token, _) in collaterals.iter() {
            if let Some(config) = e.storage().persistent().get::<_, CollateralConfig>(&DataKey::CollateralConfig(token)) {
                if config.min_collateral_ratio > min_ratio {
                    min_ratio = config.min_collateral_ratio;
                }
            }
        }

        if ratio < min_ratio as i128 {
            panic!("insufficient collateral ratio");
        }
    }

    fn check_liquidation(e: &Env, position: &VaultPosition) -> (bool, i128) {
        if position.debt == 0 {
            return (false, i128::MAX);
        }

        let collateral_value = Self::get_total_collateral_value(e, &position.collaterals);
        let smt_price = 1_0000000i128;
        let debt_value = (position.debt * smt_price) / 1_0000000;

        let ratio = (collateral_value * BP_DIVISOR as i128) / debt_value;

        // Check against the highest liquidation threshold
        let mut threshold = LIQUIDATION_THRESHOLD;
        for (token, _) in position.collaterals.iter() {
            if let Some(config) = e.storage().persistent().get::<_, CollateralConfig>(&DataKey::CollateralConfig(token)) {
                if config.liquidation_threshold > threshold {
                    threshold = config.liquidation_threshold;
                }
            }
        }

        (ratio < threshold as i128, ratio)
    }

    pub fn version(e: Env) -> String {
        String::from_str(&e, "1.0.0")
    }

    pub fn status(e: Env) -> String {
        String::from_str(&e, "alive")
    }
}
