//! # SoroMint Backstop / Insurance Fund Contract
//!
//! Collects protocol fees and holds them as a backstop reserve. In the event
//! of an exploit or liquidation shortfall the admin can draw from the fund to
//! cover losses.
//!
//! ## Roles
//! - **Admin** – can withdraw funds for coverage and update the fee rate.
//! - **Fee depositor** – any address (typically the protocol) can call
//!   `deposit_fee` to add tokens to the reserve.
//!
//! ## Fee collection
//! The contract stores a `fee_bps` (basis points) value. Helper `calc_fee`
//! returns the fee amount for a given principal so callers can compute the
//! correct deposit before calling `deposit_fee`.

#![no_std]

#[cfg(test)]
mod test;

use soroban_sdk::{contract, contractimpl, contracttype, symbol_short, token, Address, Env, String};

// ---------------------------------------------------------------------------
// Storage keys
// ---------------------------------------------------------------------------

#[contracttype]
pub enum ConfigKey {
    Admin,
    Token,
    FeeBps,
    TotalDeposited,
    TotalWithdrawn,
}

#[contracttype]
pub enum DataKey {
    Config(ConfigKey),
}

// ---------------------------------------------------------------------------
// Contract
// ---------------------------------------------------------------------------

#[contract]
pub struct Backstop;

#[contractimpl]
impl Backstop {
    /// One-time setup.
    pub fn initialize(e: Env, admin: Address, token: Address, fee_bps: u32) {
        if e.storage().instance().has(&DataKey::Config(ConfigKey::Admin)) {
            panic!("already initialized");
        }
        if fee_bps > 10_000 {
            panic!("fee_bps > 10000");
        }
        admin.require_auth();
        e.storage().instance().set(&DataKey::Config(ConfigKey::Admin), &admin);
        e.storage().instance().set(&DataKey::Config(ConfigKey::Token), &token);
        e.storage().instance().set(&DataKey::Config(ConfigKey::FeeBps), &fee_bps);
        e.storage().instance().set(&DataKey::Config(ConfigKey::TotalDeposited), &0i128);
        e.storage().instance().set(&DataKey::Config(ConfigKey::TotalWithdrawn), &0i128);
    }

    /// Deposit a fee amount into the backstop reserve.
    pub fn deposit_fee(e: Env, from: Address, amount: i128) {
        from.require_auth();
        if amount <= 0 {
            panic!("amount must be positive");
        }
        let tok: Address = e.storage().instance().get(&DataKey::Config(ConfigKey::Token)).unwrap();
        token::Client::new(&e, &tok).transfer(&from, &e.current_contract_address(), &amount);

        let total: i128 = e
            .storage()
            .instance()
            .get(&DataKey::Config(ConfigKey::TotalDeposited))
            .unwrap();
        e.storage()
            .instance()
            .set(&DataKey::Config(ConfigKey::TotalDeposited), &(total + amount));

        e.events()
            .publish((symbol_short!("fee_dep"),), (from, amount));
    }

    /// Admin withdraws `amount` to cover an exploit or liquidation shortfall.
    pub fn withdraw(e: Env, to: Address, amount: i128) {
        Self::require_admin(&e);
        if amount <= 0 {
            panic!("amount must be positive");
        }
        let tok: Address = e.storage().instance().get(&DataKey::Config(ConfigKey::Token)).unwrap();
        token::Client::new(&e, &tok).transfer(&e.current_contract_address(), &to, &amount);

        let total: i128 = e
            .storage()
            .instance()
            .get(&DataKey::Config(ConfigKey::TotalWithdrawn))
            .unwrap();
        e.storage()
            .instance()
            .set(&DataKey::Config(ConfigKey::TotalWithdrawn), &(total + amount));

        e.events()
            .publish((symbol_short!("withdraw"),), (to, amount));
    }

    /// Update the fee rate (admin only).
    pub fn set_fee_bps(e: Env, fee_bps: u32) {
        Self::require_admin(&e);
        if fee_bps > 10_000 {
            panic!("fee_bps > 10000");
        }
        e.storage().instance().set(&DataKey::Config(ConfigKey::FeeBps), &fee_bps);
        e.events()
            .publish((symbol_short!("fee_set"),), fee_bps);
    }

    /// Calculate the fee for a given principal amount.
    pub fn calc_fee(e: Env, principal: i128) -> i128 {
        let bps: u32 = e.storage().instance().get(&DataKey::Config(ConfigKey::FeeBps)).unwrap();
        principal * bps as i128 / 10_000
    }

    pub fn get_fee_bps(e: Env) -> u32 {
        e.storage().instance().get(&DataKey::Config(ConfigKey::FeeBps)).unwrap()
    }

    pub fn get_total_deposited(e: Env) -> i128 {
        e.storage().instance().get(&DataKey::Config(ConfigKey::TotalDeposited)).unwrap()
    }

    pub fn get_total_withdrawn(e: Env) -> i128 {
        e.storage().instance().get(&DataKey::Config(ConfigKey::TotalWithdrawn)).unwrap()
    }

    pub fn version(_e: Env) -> String {
        String::from_str(&_e, "1.0.0")
    }

    // -----------------------------------------------------------------------
    // Helpers
    // -----------------------------------------------------------------------

    fn require_admin(e: &Env) {
        let admin: Address = e.storage().instance().get(&DataKey::Config(ConfigKey::Admin)).unwrap();
        admin.require_auth();
    }
}
