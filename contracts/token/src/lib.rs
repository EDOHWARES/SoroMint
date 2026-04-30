//! # SoroMint Token Contract
//!
//! A Soroban-based token contract implementing the standard TokenInterface
//! with additional administrative controls and a configurable transfer tax.

#![no_std]

mod events;
#[cfg(test)]
mod test_transfer;
#[cfg(test)]
mod test_minting_limits;
#[cfg(test)]
mod test_snapshots;

use soroban_sdk::token::TokenInterface;
use soroban_sdk::{contract, contractimpl, contracttype, Address, Bytes, Env, String};

#[contracttype]
#[derive(Clone)]
pub enum ConfigKey {
    Admin,
    Name,
    Symbol,
    Decimals,
    Fee,
    Metadata,
    IsTransferable,
}

#[contracttype]
#[derive(Clone)]
pub enum AccountKey {
    Balance(Address),
    Allowance(Address, Address),
    IsVerified(Address),
    MintLimit(Address),
    MintWindow(Address),
    Nonce(Address),
}

#[contracttype]
#[derive(Clone)]
pub enum SnapshotKey {
    Balance(Address, u32),
    Supply(u32),
}

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Config(ConfigKey),
    Account(AccountKey),
    Snapshot(SnapshotKey),
    TotalSupply,
}

// Rolling 24-hour window state for a minter
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct MintWindowState {
    pub minted: i128,
    pub window_start: u64, // Unix timestamp (seconds)
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
    fn read_balance(e: &Env, id: &Address) -> i128 {
        e.storage().persistent().get(&DataKey::Account(AccountKey::Balance(id.clone()))).unwrap_or(0)
    }

    fn read_allowance(e: &Env, from: &Address, spender: &Address) -> i128 {
        e.storage().persistent().get(&DataKey::Account(AccountKey::Allowance(from.clone(), spender.clone()))).unwrap_or(0)
    }

    fn write_balance(e: &Env, id: &Address, balance: i128) {
        e.storage().persistent().set(&DataKey::Account(AccountKey::Balance(id.clone())), &balance);
    }

    fn write_allowance(e: &Env, from: &Address, spender: &Address, amount: i128) {
        e.storage().persistent().set(&DataKey::Account(AccountKey::Allowance(from.clone(), spender.clone())), &amount);
    }

    fn admin(e: Env) -> Address {
        e.storage().instance().get(&DataKey::Config(ConfigKey::Admin)).unwrap()
    }

    pub fn is_transferable(e: Env) -> bool {
        e.storage().instance().get(&DataKey::Config(ConfigKey::IsTransferable)).unwrap_or(true)
    }

    pub fn supply(e: Env) -> i128 {
        e.storage().instance().get(&DataKey::TotalSupply).unwrap_or(0)
    }

    fn move_balance(e: &Env, from: &Address, to: &Address, amount: i128) -> (i128, i128) {
        let from_balance = Self::read_balance(e, from);
        if from_balance < amount { panic!("insufficient balance"); }
        if from == to { return (from_balance, from_balance); }

        let mut amount_to_receive = amount;
        if let Some(fee_config) = e.storage().instance().get::<_, FeeConfig>(&DataKey::Config(ConfigKey::Fee)) {
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

    pub fn initialize(e: Env, admin: Address, decimals: u32, name: String, symbol: String) {
        if e.storage().instance().has(&DataKey::Config(ConfigKey::Admin)) { panic!("already initialized"); }
        e.storage().instance().set(&DataKey::Config(ConfigKey::Admin), &admin);
        e.storage().instance().set(&DataKey::Config(ConfigKey::Decimals), &decimals);
        e.storage().instance().set(&DataKey::Config(ConfigKey::Name), &name);
        e.storage().instance().set(&DataKey::Config(ConfigKey::Symbol), &symbol);
        e.storage().instance().set(&DataKey::TotalSupply, &0i128);
        e.storage().instance().set(&DataKey::Config(ConfigKey::IsTransferable), &true);
    }

    pub fn set_fee_config(e: Env, enabled: bool, fee_bps: u32, treasury: Address) {
        let admin = Self::admin(e.clone());
        admin.require_auth();
        e.storage().instance().set(&DataKey::Config(ConfigKey::Fee), &FeeConfig { enabled, fee_bps, treasury });
    }

    pub fn set_metadata_hash(e: Env, hash: Bytes) {
        let admin = Self::admin(e.clone());
        admin.require_auth();
        e.storage().instance().set(&DataKey::Config(ConfigKey::Metadata), &hash);
    }

    pub fn set_transferable(e: Env, transferable: bool) {
        let admin = Self::admin(e.clone());
        admin.require_auth();
        e.storage().instance().set(&DataKey::Config(ConfigKey::IsTransferable), &transferable);
        events::emit_transferability_updated(&e, &admin, transferable);
    }

    pub fn mint(e: Env, to: Address, amount: i128) {
        let admin = Self::admin(e.clone());
        admin.require_auth();
        let supply = e.storage().instance().get::<_, i128>(&DataKey::TotalSupply).unwrap_or(0);
        let new_to = Self::read_balance(&e, &to) + amount;
        let new_supply = supply + amount;
        Self::write_balance(&e, &to, new_to);
        e.storage().instance().set(&DataKey::TotalSupply, &new_supply);
        events::emit_mint(&e, &admin, &to, amount, new_to, new_supply);
    }

    pub fn set_verified(e: Env, addr: Address, status: bool) {
        let admin = Self::admin(e.clone());
        admin.require_auth();
        e.storage().persistent().set(&DataKey::Account(AccountKey::IsVerified(addr)), &status);
    }

    pub fn is_verified(e: Env, addr: Address) -> bool {
        e.storage().persistent().get(&DataKey::Account(AccountKey::IsVerified(addr))).unwrap_or(false)
    }

    pub fn verify_with_proof(e: Env, addr: Address, proof: Bytes) {
        // Mock ZK-Proof verification logic
        if proof.len() > 0 {
            e.storage().persistent().set(&DataKey::Account(AccountKey::IsVerified(addr)), &true);
        }
    }

    /// Set the maximum tokens a Minter role address may mint within any rolling 24-hour window.
    pub fn set_minter_limit(e: Env, minter: Address, limit: i128) {
        soromint_lifecycle::require_not_paused(&e);
        let admin = Self::admin(e.clone());
        admin.require_auth();
        if limit <= 0 { panic!("limit must be positive"); }
        e.storage().persistent().set(&DataKey::Account(AccountKey::MintLimit(minter)), &limit);
    }

    /// Returns the configured 24-hour mint limit for a minter, or None if unset.
    pub fn minter_limit(e: Env, minter: Address) -> Option<i128> {
        e.storage().persistent().get(&DataKey::Account(AccountKey::MintLimit(minter)))
    }

    /// Mint tokens as a Minter role address, subject to the rolling 24-hour cap.
    pub fn minter_mint(e: Env, minter: Address, to: Address, amount: i128) {
        soromint_lifecycle::require_not_paused(&e);
        if amount <= 0 { panic!("mint amount must be positive"); }
        minter.require_auth();

        let limit: i128 = e.storage()
            .persistent()
            .get(&DataKey::Account(AccountKey::MintLimit(minter.clone())))
            .expect("no mint limit configured for minter");

        let now: u64 = e.ledger().timestamp();
        const WINDOW: u64 = 86_400; // 24 hours in seconds

        let mut state: MintWindowState = e.storage()
            .persistent()
            .get(&DataKey::Account(AccountKey::MintWindow(minter.clone())))
            .unwrap_or(MintWindowState { minted: 0, window_start: now });

        if now >= state.window_start + WINDOW {
            state = MintWindowState { minted: 0, window_start: now };
        }

        if state.minted + amount > limit {
            panic!("minting limit exceeded for period");
        }

        state.minted += amount;
        e.storage().persistent().set(&DataKey::Account(AccountKey::MintWindow(minter.clone())), &state);

        let mut balance = Self::read_balance(&e, &to);
        balance += amount;
        Self::write_balance(&e, &to, balance);

        let mut supply: i128 = e.storage().instance().get(&DataKey::TotalSupply).unwrap_or(0);
        supply += amount;
        e.storage().instance().set(&DataKey::TotalSupply, &supply);

        events::emit_minter_mint(&e, &minter, &to, amount, balance, supply);
    }

    /// Record the current balance of `account` at the current ledger sequence.
    pub fn take_snapshot(e: Env, account: Address) -> u32 {
        let ledger = e.ledger().sequence();
        let balance = Self::read_balance(&e, &account);
        e.storage()
            .persistent()
            .set(&DataKey::Snapshot(SnapshotKey::Balance(account.clone(), ledger)), &balance);
        events::emit_snapshot_taken(&e, &account, ledger, balance);
        ledger
    }

    /// Return the balance recorded for `account` at `ledger`, or None if no snapshot exists.
    pub fn snapshot_balance(e: Env, account: Address, ledger: u32) -> Option<i128> {
        e.storage()
            .persistent()
            .get(&DataKey::Snapshot(SnapshotKey::Balance(account, ledger)))
    }

    /// Record the total supply at the current ledger sequence.
    /// Admin-only to prevent spam.
    pub fn take_supply_snapshot(e: Env) -> u32 {
        let admin = Self::admin(e.clone());
        admin.require_auth();
        let ledger = e.ledger().sequence();
        let supply: i128 = e.storage().instance().get(&DataKey::TotalSupply).unwrap_or(0);
        e.storage()
            .persistent()
            .set(&DataKey::Snapshot(SnapshotKey::Supply(ledger)), &supply);
        events::emit_supply_snapshot_taken(&e, ledger, supply);
        ledger
    }

    /// Return the total supply recorded at `ledger`, or None if no snapshot exists.
    pub fn snapshot_supply(e: Env, ledger: u32) -> Option<i128> {
        e.storage().persistent().get(&DataKey::Snapshot(SnapshotKey::Supply(ledger)))
    }
}

#[contractimpl]
impl TokenInterface for SoroMintToken {
    fn allowance(e: Env, from: Address, spender: Address) -> i128 {
        Self::read_allowance(&e, &from, &spender)
    }

    fn approve(e: Env, from: Address, spender: Address, amount: i128, expiration_ledger: u32) {
        if !Self::is_transferable(e.clone()) {
            panic!("Token is non-transferable");
        }
        from.require_auth();
        Self::write_allowance(&e, &from, &spender, amount);
        events::emit_approve(&e, &from, &spender, amount, expiration_ledger);
    }

    fn balance(e: Env, id: Address) -> i128 {
        Self::read_balance(&e, &id)
    }

    fn transfer(e: Env, from: Address, to: Address, amount: i128) {
        from.require_auth();
        if !Self::is_transferable(e.clone()) {
            panic!("Token is non-transferable");
        }
        let (new_from, new_to) = Self::move_balance(&e, &from, &to, amount);
        events::emit_transfer(&e, &from, &to, amount, new_from, new_to);
    }

    fn transfer_from(e: Env, spender: Address, from: Address, to: Address, amount: i128) {
        spender.require_auth();
        if !Self::is_transferable(e.clone()) {
            panic!("Token is non-transferable");
        }
        let allowance = Self::read_allowance(&e, &from, &spender);
        if allowance < amount { panic!("insufficient allowance"); }
        let new_allowance = allowance - amount;
        Self::write_allowance(&e, &from, &spender, new_allowance);
        let (new_from, new_to) = Self::move_balance(&e, &from, &to, amount);
        events::emit_transfer_from(&e, &spender, &from, &to, amount, new_allowance, new_from, new_to);
    }

    fn burn(e: Env, from: Address, amount: i128) {
        from.require_auth();
        let balance = Self::read_balance(&e, &from);
        if balance < amount { panic!("insufficient balance"); }
        let supply = e.storage().instance().get::<_, i128>(&DataKey::TotalSupply).unwrap();
        let new_balance = balance - amount;
        let new_supply = supply - amount;
        Self::write_balance(&e, &from, new_balance);
        e.storage().instance().set(&DataKey::TotalSupply, &new_supply);
        let admin = Self::admin(e.clone());
        events::emit_burn(&e, &admin, &from, amount, new_balance, new_supply);
    }

    fn burn_from(e: Env, spender: Address, from: Address, amount: i128) {
        spender.require_auth();
        if !Self::is_transferable(e.clone()) {
            panic!("Token is non-transferable");
        }
        let allowance = Self::read_allowance(&e, &from, &spender);
        if allowance < amount { panic!("insufficient allowance"); }
        let balance = Self::read_balance(&e, &from);
        if balance < amount { panic!("insufficient balance"); }
        let supply = e.storage().instance().get::<_, i128>(&DataKey::TotalSupply).unwrap();
        let new_allowance = allowance - amount;
        let new_balance = balance - amount;
        let new_supply = supply - amount;
        Self::write_allowance(&e, &from, &spender, new_allowance);
        Self::write_balance(&e, &from, new_balance);
        e.storage().instance().set(&DataKey::TotalSupply, &new_supply);
        let admin = Self::admin(e.clone());
        events::emit_burn(&e, &admin, &from, amount, new_balance, new_supply);
    }

    fn decimals(e: Env) -> u32 {
        e.storage().instance().get(&DataKey::Config(ConfigKey::Decimals)).unwrap()
    }

    fn name(e: Env) -> String {
        e.storage().instance().get(&DataKey::Config(ConfigKey::Name)).unwrap()
    }

    fn symbol(e: Env) -> String {
        e.storage().instance().get(&DataKey::Config(ConfigKey::Symbol)).unwrap()
    }
}