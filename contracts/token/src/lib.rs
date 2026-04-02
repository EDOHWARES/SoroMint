//! # SoroMint Token Contract
//!
//! A Soroban-based token contract implementing the standard TokenInterface
//! with additional administrative controls and a configurable transfer tax.

#![no_std]

mod events;

use soroban_sdk::token::TokenInterface;
use soroban_sdk::{contract, contractimpl, contracttype, Address, Env, String};
use soromint_lifecycle;

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Admin,
    Allowance(Address, Address),
    Balance(Address),
    Name,
    Symbol,
    Decimal,
}

/// Trait defining the full SoroMint token interface, including
/// minting, burning, balance queries, and ownership management
pub trait TokenTrait {
    /// Initializes the token contract with an admin and metadata.
    /// Can only be called once.
    fn initialize(e: Env, admin: Address, decimal: u32, name: String, symbol: String);

    /// Mints `amount` tokens to the `to` address. Admin-only.
    fn mint(e: Env, to: Address, amount: i128);

    /// Burns `amount` tokens from the `from` address. Admin-only.
    fn burn(e: Env, from: Address, amount: i128);

    /// Returns the token balance for the given address.
    fn balance(e: Env, id: Address) -> i128;

    /// Returns the total token supply.
    fn supply(e: Env) -> i128;

    /// Transfers the admin role to a new address. Current admin-only.
    fn transfer_ownership(e: Env, new_admin: Address);

    /// Updates the token name and symbol. Admin-only.
    fn update_metadata(e: Env, name: String, symbol: String);

    /// Returns the token name.
    fn name(e: Env) -> String;

    /// Returns the token symbol.
    fn symbol(e: Env) -> String;

    /// Returns the token decimals.
    fn decimals(e: Env) -> u32;
    Decimals,
    Name,
    Symbol,
    Supply,
    MetadataHash,
    FeeConfig,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct FeeConfig {
    pub enabled: bool,
    pub fee_bps: u32, // Basis points (100 = 1%, 1000 = 10%)
    pub treasury: Address,
}

#[contract]
pub struct SoroMintToken;

#[contractimpl]
impl SoroMintToken {
    /// Internal helpers
    fn read_balance(e: &Env, id: &Address) -> i128 {
        e.storage().persistent().get(&DataKey::Balance(id.clone())).unwrap_or(0)
    }

    fn read_allowance(e: &Env, from: &Address, spender: &Address) -> i128 {
        e.storage().persistent().get(&DataKey::Allowance(from.clone(), spender.clone())).unwrap_or(0)
    }

    fn write_balance(e: &Env, id: &Address, balance: i128) {
        e.storage().persistent().set(&DataKey::Balance(id.clone()), &balance);
    }

    fn write_allowance(e: &Env, from: &Address, spender: &Address, amount: i128) {
        e.storage().persistent().set(&DataKey::Allowance(from.clone(), spender.clone()), &amount);
    }

    fn move_balance(e: &Env, from: &Address, to: &Address, amount: i128) -> (i128, i128) {
        let from_balance = Self::read_balance(e, from);
        if from_balance < amount { panic!("insufficient balance"); }
        if from == to { return (from_balance, from_balance); }

        let mut amount_to_receive = amount;
        if let Some(fee_config) = e.storage().instance().get::<_, FeeConfig>(&DataKey::FeeConfig) {
            if fee_config.enabled && fee_config.fee_bps > 0 {
                let fee_amount = amount.checked_mul(fee_config.fee_bps as i128).unwrap().checked_div(10000).unwrap();
                if fee_amount > 0 {
                    let treasury_balance = Self::read_balance(e, &fee_config.treasury);
                    Self::write_balance(e, &fee_config.treasury, treasury_balance + fee_amount);
                    amount_to_receive -= fee_amount;
                    events::emit_fee_collected(e, from, &fee_config.treasury, fee_amount);
                }
            }
        }

        let new_from = from_balance - amount;
        let new_to = Self::read_balance(e, to) + amount_to_receive;
        Self::write_balance(e, from, new_from);
        Self::write_balance(e, to, new_to);
        (new_from, new_to)
    }

    /// Admin Functions
    pub fn initialize(e: Env, admin: Address, decimal: u32, name: String, symbol: String) {
        if e.storage().instance().has(&DataKey::Admin) { panic!("already initialized"); }
        e.storage().instance().set(&DataKey::Admin, &admin);
        e.storage().instance().set(&DataKey::Supply, &0i128);
        e.storage().instance().set(&DataKey::Name, &name);
        e.storage().instance().set(&DataKey::Symbol, &symbol);
        e.storage().instance().set(&DataKey::Decimal, &decimal);

        e.storage().instance().set(&DataKey::Decimals, &decimal);
        e.storage().instance().set(&DataKey::Name, &name);
        e.storage().instance().set(&DataKey::Symbol, &symbol);
        events::emit_initialized(&e, &admin, decimal, &name, &symbol);
    }

    pub fn mint(e: Env, to: Address, amount: i128) {
        soromint_lifecycle::require_not_paused(&e);
        if amount <= 0 { panic!("mint amount must be positive"); }
        let admin: Address = e.storage().instance().get(&DataKey::Admin).unwrap();
        admin.require_auth();

        let mut balance = Self::read_balance(&e, &to);
        balance += amount;
        Self::write_balance(&e, &to, balance);

        let mut supply: i128 = e.storage().instance().get(&DataKey::Supply).unwrap_or(0);
        supply += amount;
        e.storage().instance().set(&DataKey::Supply, &supply);
        events::emit_mint(&e, &admin, &to, amount, balance, supply);
    }

    /// Burns tokens from a holder's balance.
    ///
    /// # Arguments
    /// * `from`   - The address whose tokens will be burned.
    /// * `amount` - The quantity of tokens to burn.
    ///
    /// # Authorization
    /// Requires the current admin to authorize the transaction.
    ///
    /// # Panics
    /// Panics if `from` has insufficient balance.
    ///
    /// # Events
    /// Emits a `burn` event with `(admin, from, amount, new_balance, new_supply)`.
    pub fn burn(e: Env, from: Address, amount: i128) {
        if amount <= 0 {
            panic!("burn amount must be positive");
        }
    pub fn v2_mint(e: Env, to: Address, amount: i128, memo: String) {
        if memo.len() == 0 { panic!("memo must not be empty"); }
        soromint_lifecycle::require_not_paused(&e);
        if amount <= 0 { panic!("mint amount must be positive"); }
        let admin: Address = e.storage().instance().get(&DataKey::Admin).unwrap();
        admin.require_auth();

        let mut balance = Self::read_balance(&e, &to);
        balance += amount;
        Self::write_balance(&e, &to, balance);

        let mut supply: i128 = e.storage().instance().get(&DataKey::Supply).unwrap_or(0);
        supply += amount;
        e.storage().instance().set(&DataKey::Supply, &supply);
        events::emit_mint(&e, &admin, &to, amount, balance, supply);
    }

    pub fn transfer_ownership(e: Env, new_admin: Address) {
        let admin: Address = e.storage().instance().get(&DataKey::Admin).unwrap();
        admin.require_auth();
        e.storage().instance().set(&DataKey::Admin, &new_admin);
        events::emit_ownership_transfer(&e, &admin, &new_admin);
    }

    pub fn set_metadata_hash(e: Env, hash: String) {
        let admin: Address = e.storage().instance().get(&DataKey::Admin).unwrap();
        admin.require_auth();
        e.storage().instance().set(&DataKey::MetadataHash, &hash);
        events::emit_metadata_updated(&e, &admin, &hash);
    }

    pub fn metadata_hash(e: Env) -> Option<String> {
        e.storage().instance().get(&DataKey::MetadataHash)
    }

    pub fn set_fee_config(e: Env, enabled: bool, fee_bps: u32, treasury: Address) {
        let admin: Address = e.storage().instance().get(&DataKey::Admin).unwrap();
        admin.require_auth();
        if fee_bps > 1000 { panic!("fee percentage exceeds maximum cap of 10%"); }
        let config = FeeConfig { enabled, fee_bps, treasury: treasury.clone() };
        e.storage().instance().set(&DataKey::FeeConfig, &config);
        events::emit_fee_config_updated(&e, &admin, enabled, fee_bps, &treasury);
    }

    pub fn fee_config(e: Env) -> Option<FeeConfig> {
        e.storage().instance().get(&DataKey::FeeConfig)
    }

    pub fn version(e: Env) -> String { String::from_str(&e, "2.0.0") }
    pub fn status(e: Env) -> String { String::from_str(&e, "alive") }
    pub fn supply(e: Env) -> i128 { e.storage().instance().get(&DataKey::Supply).unwrap_or(0) }
    pub fn pause(e: Env) {
        let admin: Address = e.storage().instance().get(&DataKey::Admin).unwrap();
        soromint_lifecycle::pause(e, admin);
    }
    pub fn unpause(e: Env) {
        let admin: Address = e.storage().instance().get(&DataKey::Admin).unwrap();
        soromint_lifecycle::unpause(e, admin);
    }
}

#[contractimpl]
impl TokenInterface for SoroMintToken {
    fn allowance(e: Env, from: Address, spender: Address) -> i128 { Self::read_allowance(&e, &from, &spender) }
    fn approve(e: Env, from: Address, spender: Address, amount: i128, _exp: u32) {
        from.require_auth();
        if amount < 0 { panic!("approval amount must be non-negative"); }
        Self::write_allowance(&e, &from, &spender, amount);
        events::emit_approve(&e, &from, &spender, amount);
    }
    fn balance(e: Env, id: Address) -> i128 { Self::read_balance(&e, &id) }
    fn transfer(e: Env, from: Address, to: Address, amount: i128) {
        soromint_lifecycle::require_not_paused(&e);
        from.require_auth();
        if amount <= 0 { panic!("transfer amount must be positive"); }
        let (nf, nt) = Self::move_balance(&e, &from, &to, amount);
        events::emit_transfer(&e, &from, &to, amount, nf, nt);
    }
    fn transfer_from(e: Env, spender: Address, from: Address, to: Address, amount: i128) {
        soromint_lifecycle::require_not_paused(&e);
        spender.require_auth();
        if amount <= 0 { panic!("transfer amount must be positive"); }
        let al = Self::read_allowance(&e, &from, &spender);
        if al < amount { panic!("insufficient allowance"); }
        let (nf, nt) = Self::move_balance(&e, &from, &to, amount);
        Self::write_allowance(&e, &from, &spender, al - amount);
        events::emit_transfer_from(&e, &spender, &from, &to, amount, al - amount, nf, nt);
    }
    fn burn(e: Env, from: Address, amount: i128) {
        soromint_lifecycle::require_not_paused(&e);
        from.require_auth();
        if amount <= 0 { panic!("burn amount must be positive"); }
        let bal = Self::read_balance(&e, &from);
        if bal < amount { panic!("insufficient balance"); }
        Self::write_balance(&e, &from, bal - amount);
        let mut supply: i128 = e.storage().instance().get(&DataKey::Supply).unwrap_or(0);
        supply -= amount;
        e.storage().instance().set(&DataKey::Supply, &supply);
        let admin: Address = e.storage().instance().get(&DataKey::Admin).unwrap();
        events::emit_burn(&e, &admin, &from, amount, bal - amount, supply);
    }
    fn burn_from(e: Env, spender: Address, from: Address, amount: i128) {
        soromint_lifecycle::require_not_paused(&e);
        spender.require_auth();
        if amount <= 0 { panic!("burn amount must be positive"); }
        let al = Self::read_allowance(&e, &from, &spender);
        if al < amount { panic!("insufficient allowance"); }
        let bal = Self::read_balance(&e, &from);
        if bal < amount { panic!("insufficient balance"); }
        Self::write_allowance(&e, &from, &spender, al - amount);
        Self::write_balance(&e, &from, bal - amount);
        let mut supply: i128 = e.storage().instance().get(&DataKey::Supply).unwrap_or(0);
        supply -= amount;
        e.storage().instance().set(&DataKey::Supply, &supply);
        let admin: Address = e.storage().instance().get(&DataKey::Admin).unwrap();
        events::emit_burn(&e, &admin, &from, amount, bal - amount, supply);
    }

    /// Updates the name and symbol of the token.
    ///
    /// # Arguments
    /// * `new_name`   - The new human-readable token name.
    /// * `new_symbol` - The new token ticker symbol.
    ///
    /// # Authorization
    /// Requires the current admin to authorize the transaction.
    ///
    /// # Events
    /// Emits a `metadata_updated` event with `(admin, old_name, old_symbol, new_name, new_symbol)`.
    pub fn update_metadata(e: Env, new_name: String, new_symbol: String) {
        let admin: Address = e.storage().instance().get(&DataKey::Admin).unwrap();
        admin.require_auth();

        let old_name: String = e.storage().instance().get(&DataKey::Name).unwrap();
        let old_symbol: String = e.storage().instance().get(&DataKey::Symbol).unwrap();

        e.storage().instance().set(&DataKey::Name, &new_name);
        e.storage().instance().set(&DataKey::Symbol, &new_symbol);

        events::emit_metadata_updated(&e, &admin, &old_name, &old_symbol, &new_name, &new_symbol);
    }

    /// Returns the token name.
    ///
    /// # Returns
    /// The current human-readable name.
    pub fn name(e: Env) -> String {
        e.storage().instance().get(&DataKey::Name).unwrap()
    }

    /// Returns the token symbol.
    ///
    /// # Returns
    /// The current ticker symbol.
    pub fn symbol(e: Env) -> String {
        e.storage().instance().get(&DataKey::Symbol).unwrap()
    }

    /// Returns the token decimals.
    ///
    /// # Returns
    /// The number of decimal places used by the token.
    pub fn decimals(e: Env) -> u32 {
        e.storage().instance().get(&DataKey::Decimal).unwrap()
    }
    fn decimals(e: Env) -> u32 { e.storage().instance().get(&DataKey::Decimals).unwrap_or(7) }
    fn name(e: Env) -> String { e.storage().instance().get(&DataKey::Name).unwrap_or_else(|| String::from_str(&e, "SoroMint")) }
    fn symbol(e: Env) -> String { e.storage().instance().get(&DataKey::Symbol).unwrap_or_else(|| String::from_str(&e, "SMT")) }
}

