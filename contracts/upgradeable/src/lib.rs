//! # SoroMint Upgradeable Contract
//!
//! Demonstrates the standard Soroban upgrade pattern: the admin can replace
//! the contract's WASM while all persistent state is preserved.
//!
//! ## Upgrade flow
//! 1. Deploy and call `initialize(admin)`.
//! 2. Upload new WASM to the network, obtain its 32-byte hash.
//! 3. Admin calls `upgrade(new_wasm_hash)` — the runtime swaps the WASM
//!    in-place; all storage keys survive unchanged.

#![no_std]

#[cfg(test)]
mod test;

use soroban_sdk::{contract, contractimpl, contracttype, symbol_short, Address, BytesN, Env, String};

// ---------------------------------------------------------------------------
// Storage keys
// ---------------------------------------------------------------------------

#[contracttype]
pub enum ConfigKey {
    Admin,
    Version,
}

#[contracttype]
pub enum DataKey {
    Config(ConfigKey),
}

// ---------------------------------------------------------------------------
// Contract
// ---------------------------------------------------------------------------

#[contract]
pub struct Upgradeable;

#[contractimpl]
impl Upgradeable {
    /// One-time setup.
    pub fn initialize(e: Env, admin: Address) {
        if e.storage().instance().has(&DataKey::Config(ConfigKey::Admin)) {
            panic!("already initialized");
        }
        admin.require_auth();
        e.storage().instance().set(&DataKey::Config(ConfigKey::Admin), &admin);
        e.storage().instance().set(&DataKey::Config(ConfigKey::Version), &1u32);
    }

    /// Replace the contract WASM. State is preserved across the upgrade.
    pub fn upgrade(e: Env, new_wasm_hash: BytesN<32>) {
        let admin: Address = e.storage().instance().get(&DataKey::Config(ConfigKey::Admin)).unwrap();
        admin.require_auth();

        e.deployer().update_current_contract_wasm(new_wasm_hash.clone());

        let ver: u32 = e.storage().instance().get(&DataKey::Config(ConfigKey::Version)).unwrap_or(1);
        e.storage().instance().set(&DataKey::Config(ConfigKey::Version), &(ver + 1));

        e.events()
            .publish((symbol_short!("upgraded"),), new_wasm_hash);
    }

    /// Transfer admin rights to a new address.
    pub fn set_admin(e: Env, new_admin: Address) {
        let admin: Address = e.storage().instance().get(&DataKey::Config(ConfigKey::Admin)).unwrap();
        admin.require_auth();
        e.storage().instance().set(&DataKey::Config(ConfigKey::Admin), &new_admin);
        e.events()
            .publish((symbol_short!("adm_set"),), new_admin);
    }

    pub fn get_admin(e: Env) -> Address {
        e.storage().instance().get(&DataKey::Config(ConfigKey::Admin)).unwrap()
    }

    pub fn get_version(e: Env) -> u32 {
        e.storage().instance().get(&DataKey::Config(ConfigKey::Version)).unwrap_or(1)
    }

    pub fn version(_e: Env) -> String {
        String::from_str(&_e, "1.0.0")
    }
}
