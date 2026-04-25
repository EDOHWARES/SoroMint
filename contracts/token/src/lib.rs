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
pub enum DataKey {
    Admin,
    Allowance(Address, Address),
    Balance(Address),
    Name,
    Symbol,
    Decimals,
    Supply,
    MetadataHash,
    FeeConfig,
    Transferable,
    Verified(Address),
    MintLimit(Address),
    MintWindow(Address),
    Snapshot(Address, u32),  // (account, ledger_sequence) -> i128
    SupplySnapshot(u32),     // ledger_sequence -> i128
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
        e.storage()
            .persistent()
            .get(&DataKey::Balance(id.clone()))
            .unwrap_or(0)
    }

    fn read_allowance(e: &Env, from: &Address, spender: &Address) -> i128 {
        e.storage()
            .persistent()
            .get(&DataKey::Allowance(from.clone(), spender.clone()))
            .unwrap_or(0)
    }

    fn write_balance(e: &Env, id: &Address, balance: i128) {
        e.storage()
            .persistent()
            .set(&DataKey::Balance(id.clone()), &balance);
    }

    fn write_allowance(e: &Env, from: &Address, spender: &Address, amount: i128) {
        e.storage()
            .persistent()
            .set(&DataKey::Allowance(from.clone(), spender.clone()), &amount);
    }

    fn move_balance(e: &Env, from: &Address, to: &Address, amount: i128) -> (i128, i128) {
        if amount <= 0 {
            panic!("amount must be positive");
        }
        let from_balance = Self::read_balance(e, from);
        if from_balance < amount {
            panic!("insufficient balance");
        }
        if from == to {
            return (from_balance, from_balance);
        }

        let mut amount_to_receive = amount;
        if let Some(fee_config) = e.storage().instance().get::<_, FeeConfig>(&DataKey::FeeConfig) {
            if fee_config.enabled && fee_config.fee_bps > 0 {
                let fee_amount = amount
                    .checked_mul(fee_config.fee_bps as i128)
                    .expect("transfer fee multiplication overflow")
                    .checked_div(10000)
                    .expect("transfer fee division failed");
                if fee_amount > 0 {
                    let treasury_balance = Self::read_balance(e, &fee_config.treasury);
                    let new_treasury_balance = treasury_balance
                        .checked_add(fee_amount)
                        .expect("treasury balance addition overflow");
                    Self::write_balance(e, &fee_config.treasury, new_treasury_balance);
                    amount_to_receive = amount_to_receive
                        .checked_sub(fee_amount)
                        .expect("amount underflow after fee");
                    events::emit_fee_collected(e, from, &fee_config.treasury, fee_amount);
                }
            }
        }

        let new_from = from_balance
            .checked_sub(amount)
            .expect("sender balance subtraction underflow");
        let new_to = Self::read_balance(e, to)
            .checked_add(amount_to_receive)
            .expect("recipient balance addition overflow");
        Self::write_balance(e, from, new_from);
        Self::write_balance(e, to, new_to);
        (new_from, new_to)
    }

    pub fn initialize(e: Env, admin: Address, decimals: u32, name: String, symbol: String) {
        if e.storage().instance().has(&DataKey::Admin) {
            panic!("already initialized");
        }
        e.storage().instance().set(&DataKey::Admin, &admin);
        e.storage().instance().set(&DataKey::Decimals, &decimals);
        e.storage().instance().set(&DataKey::Name, &name);
        e.storage().instance().set(&DataKey::Symbol, &symbol);
        e.storage().instance().set(&DataKey::Supply, &0i128);
        e.storage().instance().set(&DataKey::Transferable, &true);
    }

    pub fn set_fee_config(e: Env, enabled: bool, fee_bps: u32, treasury: Address) {
        let admin: Address = e.storage().instance().get(&DataKey::Admin).unwrap();
        admin.require_auth();
        if fee_bps > 1000 {
            panic!("fee percentage exceeds maximum cap of 10%");
        }
        e.storage().instance().set(
            &DataKey::FeeConfig,
            &FeeConfig {
                enabled,
                fee_bps,
                treasury: treasury.clone(),
            },
        );
        events::emit_fee_config_updated(&e, &admin, enabled, fee_bps, &treasury);
    }

    pub fn set_metadata_hash(e: Env, hash: Bytes) {
        let admin: Address = e.storage().instance().get(&DataKey::Admin).unwrap();
        admin.require_auth();
        e.storage().instance().set(&DataKey::MetadataHash, &hash);
    }

    pub fn set_transferable(e: Env, transferable: bool) {
        let admin: Address = e.storage().instance().get(&DataKey::Admin).unwrap();
        admin.require_auth();
        e.storage().instance().set(&DataKey::Transferable, &transferable);
        events::emit_transferability_updated(&e, &admin, transferable);
    }

    pub fn is_transferable(e: Env) -> bool {
        e.storage()
            .instance()
            .get::<_, bool>(&DataKey::Transferable)
            .unwrap_or(true)
    }

    pub fn supply(e: Env) -> i128 {
        e.storage().instance().get(&DataKey::Supply).unwrap_or(0)
    }

    pub fn mint(e: Env, to: Address, amount: i128) {
        if amount <= 0 {
            panic!("mint amount must be positive");
        }
        let admin: Address = e.storage().instance().get(&DataKey::Admin).unwrap();
        admin.require_auth();
        let supply = e.storage().instance().get::<_, i128>(&DataKey::Supply).unwrap_or(0);
        let new_to = Self::read_balance(&e, &to)
            .checked_add(amount)
            .expect("mint balance addition overflow");
        let new_supply = supply
            .checked_add(amount)
            .expect("mint supply addition overflow");
        Self::write_balance(&e, &to, new_to);
        e.storage().instance().set(&DataKey::Supply, &new_supply);
        events::emit_mint(&e, &admin, &to, amount, new_to, new_supply);
    }

    pub fn set_verified(e: Env, addr: Address, status: bool) {
        let admin: Address = e.storage().instance().get(&DataKey::Admin).unwrap();
        admin.require_auth();
        e.storage().persistent().set(&DataKey::Verified(addr), &status);
    }

    pub fn is_verified(e: Env, addr: Address) -> bool {
        e.storage().persistent().get(&DataKey::Verified(addr)).unwrap_or(false)
    }

    pub fn verify_with_proof(e: Env, addr: Address, proof: Bytes) {
        // Mock ZK-Proof verification logic
        if proof.len() > 0 {
            e.storage().persistent().set(&DataKey::Verified(addr), &true);
        }
    }

    pub fn set_minter_limit(e: Env, minter: Address, limit: i128) {
        soromint_lifecycle::require_not_paused(&e);
        let admin: Address = e.storage().instance().get(&DataKey::Admin).unwrap();
        admin.require_auth();
        if limit <= 0 {
            panic!("limit must be positive");
        }
        e.storage().persistent().set(&DataKey::MintLimit(minter), &limit);
    }

    pub fn minter_limit(e: Env, minter: Address) -> Option<i128> {
        e.storage().persistent().get(&DataKey::MintLimit(minter))
    }

    pub fn minter_mint(e: Env, minter: Address, to: Address, amount: i128) {
        soromint_lifecycle::require_not_paused(&e);
        if amount <= 0 {
            panic!("mint amount must be positive");
        }
        minter.require_auth();

        let limit: i128 = e.storage()
            .persistent()
            .get(&DataKey::MintLimit(minter.clone()))
            .expect("no mint limit configured for minter");

        let now: u64 = e.ledger().timestamp();
        const WINDOW: u64 = 86_400; // 24 hours in seconds

        let mut state: MintWindowState = e.storage()
            .persistent()
            .get(&DataKey::MintWindow(minter.clone()))
            .unwrap_or(MintWindowState { minted: 0, window_start: now });

        let window_end = state
            .window_start
            .checked_add(WINDOW)
            .expect("mint window end overflow");
        if now >= window_end {
            state = MintWindowState { minted: 0, window_start: now };
        }

        let new_minted = state
            .minted
            .checked_add(amount)
            .expect("mint window addition overflow");
        if new_minted > limit {
            panic!("minting limit exceeded for period");
        }

        state.minted = new_minted;
        e.storage().persistent().set(&DataKey::MintWindow(minter.clone()), &state);

        let mut balance = Self::read_balance(&e, &to);
        balance = balance
            .checked_add(amount)
            .expect("minter mint balance addition overflow");
        Self::write_balance(&e, &to, balance);

        let mut supply: i128 = e.storage().instance().get(&DataKey::Supply).unwrap_or(0);
        supply = supply
            .checked_add(amount)
            .expect("minter mint supply addition overflow");
        e.storage().instance().set(&DataKey::Supply, &supply);

        events::emit_minter_mint(&e, &minter, &to, amount, balance, supply);
    }

    pub fn take_snapshot(e: Env, account: Address) -> u32 {
        let ledger = e.ledger().sequence();
        let balance = Self::read_balance(&e, &account);
        e.storage()
            .persistent()
            .set(&DataKey::Snapshot(account.clone(), ledger), &balance);
        events::emit_snapshot_taken(&e, &account, ledger, balance);
        ledger
    }

    pub fn snapshot_balance(e: Env, account: Address, ledger: u32) -> Option<i128> {
        e.storage()
            .persistent()
            .get(&DataKey::Snapshot(account, ledger))
    }

    pub fn take_supply_snapshot(e: Env) -> u32 {
        let admin: Address = e.storage().instance().get(&DataKey::Admin).unwrap();
        admin.require_auth();
        let ledger = e.ledger().sequence();
        let supply: i128 = e.storage().instance().get(&DataKey::Supply).unwrap_or(0);
        e.storage()
            .persistent()
            .set(&DataKey::SupplySnapshot(ledger), &supply);
        events::emit_supply_snapshot_taken(&e, ledger, supply);
        ledger
    }

    pub fn snapshot_supply(e: Env, ledger: u32) -> Option<i128> {
        e.storage().persistent().get(&DataKey::SupplySnapshot(ledger))
    }
}

#[contractimpl]
impl TokenInterface for SoroMintToken {
    fn allowance(e: Env, from: Address, spender: Address) -> i128 {
        Self::read_allowance(&e, &from, &spender)
    }

    fn approve(e: Env, from: Address, spender: Address, amount: i128, expiration_ledger: u32) {
        soromint_lifecycle::require_not_paused(&e);
        from.require_auth();
        if !Self::is_transferable(e.clone()) {
            panic!("Token is non-transferable");
        }
        if amount < 0 {
            panic!("approval amount must be non-negative");
        }
        Self::write_allowance(&e, &from, &spender, amount);
        let _ = expiration_ledger;
        events::emit_approve(&e, &from, &spender, amount);
    }

    fn balance(e: Env, id: Address) -> i128 {
        Self::read_balance(&e, &id)
    }

    fn transfer(e: Env, from: Address, to: Address, amount: i128) {
        soromint_lifecycle::require_not_paused(&e);
        from.require_auth();
        if !Self::is_transferable(e.clone()) {
            panic!("Token is non-transferable");
        }
        let (new_from, new_to) = Self::move_balance(&e, &from, &to, amount);
        events::emit_transfer(&e, &from, &to, amount, new_from, new_to);
    }

    fn transfer_from(e: Env, spender: Address, from: Address, to: Address, amount: i128) {
        soromint_lifecycle::require_not_paused(&e);
        spender.require_auth();
        if !Self::is_transferable(e.clone()) {
            panic!("Token is non-transferable");
        }
        let allowance = Self::read_allowance(&e, &from, &spender);
        if allowance < amount {
            panic!("insufficient allowance");
        }
        let remaining_allowance = allowance
            .checked_sub(amount)
            .expect("allowance subtraction underflow");
        Self::write_allowance(&e, &from, &spender, remaining_allowance);
        let (new_from, new_to) = Self::move_balance(&e, &from, &to, amount);
        events::emit_transfer_from(
            &e,
            &spender,
            &from,
            &to,
            amount,
            remaining_allowance,
            new_from,
            new_to,
        );
    }

    fn burn(e: Env, from: Address, amount: i128) {
        soromint_lifecycle::require_not_paused(&e);
        from.require_auth();
        if amount <= 0 {
            panic!("burn amount must be positive");
        }
        let balance = Self::read_balance(&e, &from);
        if balance < amount {
            panic!("insufficient balance");
        }
        let supply = e.storage().instance().get::<_, i128>(&DataKey::Supply).unwrap_or(0);
        let new_balance = balance
            .checked_sub(amount)
            .expect("burn balance subtraction underflow");
        let new_supply = supply
            .checked_sub(amount)
            .expect("burn supply subtraction underflow");
        Self::write_balance(&e, &from, new_balance);
        e.storage().instance().set(&DataKey::Supply, &new_supply);
        let admin: Address = e.storage().instance().get(&DataKey::Admin).unwrap();
        events::emit_burn(&e, &admin, &from, amount, new_balance, new_supply);
    }

    fn burn_from(e: Env, spender: Address, from: Address, amount: i128) {
        soromint_lifecycle::require_not_paused(&e);
        spender.require_auth();
        if !Self::is_transferable(e.clone()) {
            panic!("Token is non-transferable");
        }
        if amount <= 0 {
            panic!("burn amount must be positive");
        }
        let allowance = Self::read_allowance(&e, &from, &spender);
        if allowance < amount {
            panic!("insufficient allowance");
        }
        let balance = Self::read_balance(&e, &from);
        if balance < amount {
            panic!("insufficient balance");
        }
        let supply = e.storage().instance().get::<_, i128>(&DataKey::Supply).unwrap_or(0);
        let remaining_allowance = allowance
            .checked_sub(amount)
            .expect("burn_from allowance subtraction underflow");
        let new_balance = balance
            .checked_sub(amount)
            .expect("burn_from balance subtraction underflow");
        let new_supply = supply
            .checked_sub(amount)
            .expect("burn_from supply subtraction underflow");
        Self::write_allowance(&e, &from, &spender, remaining_allowance);
        Self::write_balance(&e, &from, new_balance);
        e.storage().instance().set(&DataKey::Supply, &new_supply);
        let admin: Address = e.storage().instance().get(&DataKey::Admin).unwrap();
        events::emit_burn(&e, &admin, &from, amount, new_balance, new_supply);
    }

    fn decimals(e: Env) -> u32 {
        e.storage().instance().get(&DataKey::Decimals).unwrap()
    }

    fn name(e: Env) -> String {
        e.storage().instance().get(&DataKey::Name).unwrap()
    }

    fn symbol(e: Env) -> String {
        e.storage().instance().get(&DataKey::Symbol).unwrap()
    }
}
