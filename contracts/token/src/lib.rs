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
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct TokenInfo {
    pub admin: Address,
    pub supply: i128,
    pub decimals: u32,
    pub name: String,
    pub symbol: String,
}

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    TokenInfo,
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
    /// Initializes the SoroMint token contract.
    pub fn initialize(e: Env, admin: Address, decimal: u32, name: String, symbol: String) {
        if e.storage().instance().has(&DataKey::TokenInfo) {
            panic!("already initialized");
        }

        let info = TokenInfo {
            admin: admin.clone(),
            supply: 0,
            decimals: decimal,
            name: name.clone(),
            symbol: symbol.clone(),
        };

        e.storage().instance().set(&DataKey::TokenInfo, &info);

        // Issue #493: Mandatory Event Logging
        events::emit_initialized(&e, &admin, decimal, &name, &symbol);
    }

    /// Mints new tokens to a recipient address.
    pub fn mint(e: Env, to: Address, amount: i128) {
        if amount <= 0 {
            panic!("mint amount must be positive");
        }
        
        let mut info: TokenInfo = e.storage().instance().get(&DataKey::TokenInfo).expect("Not initialized");
        info.admin.require_auth();

        let mut balance = Self::balance(e.clone(), to.clone());
        balance = balance.checked_add(amount).expect("balance overflow");
        e.storage().persistent().set(&DataKey::Balance(to.clone()), &balance);

        info.supply = info.supply.checked_add(amount).expect("supply overflow");
        e.storage().instance().set(&DataKey::TokenInfo, &info);

        // Issue #493: Mandatory Event Logging
        events::emit_mint(&e, &info.admin, &to, amount, balance, info.supply);
    }

    /// Burns tokens from a holder's balance.
    pub fn burn(e: Env, from: Address, amount: i128) {
        let mut info: TokenInfo = e.storage().instance().get(&DataKey::TokenInfo).expect("Not initialized");
        info.admin.require_auth();

        let mut balance = Self::balance(e.clone(), from.clone());
        if balance < amount {
            panic!("insufficient balance to burn");
        }
        
        balance -= amount;
        e.storage().persistent().set(&DataKey::Balance(from.clone()), &balance);

        info.supply -= amount;
        e.storage().instance().set(&DataKey::TokenInfo, &info);

        // Issue #493: Mandatory Event Logging
        events::emit_burn(&e, &info.admin, &from, amount, balance, info.supply);
    }

    /// Returns the token balance for a given address.
    pub fn balance(e: Env, id: Address) -> i128 {
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

    /// Initializes the contract with an administrator, decimals, name, and symbol.
    /// 
    /// # Arguments
    /// * `admin` - The address of the contract administrator.
    /// * `decimals` - The number of decimals for the token.
    /// * `name` - The human-readable name of the token.
    /// * `symbol` - The ticker symbol for the token.
    pub fn initialize(e: Env, admin: Address, decimals: u32, name: String, symbol: String) {
        if e.storage().instance().has(&DataKey::Admin) { panic!("already initialized"); }
        e.storage().instance().set(&DataKey::Admin, &admin);
        e.storage().instance().set(&DataKey::Decimals, &decimals);
        e.storage().instance().set(&DataKey::Name, &name);
        e.storage().instance().set(&DataKey::Symbol, &symbol);
        e.storage().instance().set(&DataKey::Supply, &0i128);
        e.storage().instance().set(&DataKey::Transferable, &true);
    }

    /// Configures the transfer fee for the token.
    /// 
    /// # Arguments
    /// * `enabled` - Whether the fee is active.
    /// * `fee_bps` - The fee in basis points (e.g., 100 = 1%).
    /// * `treasury` - The address where collected fees will be sent.
    pub fn set_fee_config(e: Env, enabled: bool, fee_bps: u32, treasury: Address) {
        let admin: Address = e.storage().instance().get(&DataKey::Admin).unwrap();
        admin.require_auth();
        e.storage().instance().set(&DataKey::FeeConfig, &FeeConfig { enabled, fee_bps, treasury });
    }

    /// Sets a hash of external metadata (e.g., IPFS) for the token.
    /// 
    /// # Arguments
    /// * `hash` - The metadata hash as Bytes.
    pub fn set_metadata_hash(e: Env, hash: Bytes) {
        let admin: Address = e.storage().instance().get(&DataKey::Admin).unwrap();
        admin.require_auth();
        e.storage().instance().set(&DataKey::MetadataHash, &hash);
    }

    /// Enables or disables token transfers globally.
    /// 
    /// # Arguments
    /// * `transferable` - True to enable transfers, false to disable.
    pub fn set_transferable(e: Env, transferable: bool) {
        let admin: Address = e.storage().instance().get(&DataKey::Admin).unwrap();
        admin.require_auth();
        e.storage().instance().set(&DataKey::Transferable, &transferable);
    }

    /// Mints new tokens to a specified address. Only callable by the admin.
    /// 
    /// # Arguments
    /// * `to` - The recipient of the minted tokens.
    /// * `amount` - The amount of tokens to mint.
    pub fn mint(e: Env, to: Address, amount: i128) {
        let admin: Address = e.storage().instance().get(&DataKey::Admin).unwrap();
        admin.require_auth();
        let supply = e.storage().instance().get::<_, i128>(&DataKey::Supply).unwrap();
        let new_to = Self::read_balance(&e, &to) + amount;
        Self::write_balance(&e, &to, new_to);
        e.storage().instance().set(&DataKey::Supply, &(supply + amount));
        events::emit_mint(&e, admin, to, amount);
    }

    /// Sets a 24-hour minting limit for a specific minter address.
    /// 
    /// # Arguments
    /// * `minter` - The address of the minter.
    /// * `limit` - The maximum amount they can mint in a 24h window.
    pub fn set_minter_limit(e: Env, minter: Address, limit: i128) {
        let admin: Address = e.storage().instance().get(&DataKey::Admin).unwrap();
        admin.require_auth();
        e.storage().persistent().set(&DataKey::MintLimit(minter), &limit);
    }

    pub fn minter_mint(e: Env, minter: Address, to: Address, amount: i128) {
        minter.require_auth();
        
        let limit: i128 = e.storage().persistent().get(&DataKey::MintLimit(minter.clone())).expect("no mint limit set for this minter");
        let mut window: MintWindowState = e.storage().persistent().get(&DataKey::MintWindow(minter.clone())).unwrap_or(MintWindowState { minted: 0, window_start: e.ledger().timestamp() });

        if e.ledger().timestamp() >= window.window_start + 86400 {
            window.minted = 0;
            window.window_start = e.ledger().timestamp();
        }

        if window.minted + amount > limit {
            panic!("minting limit exceeded for this 24h window");
        }

        window.minted += amount;
        e.storage().persistent().set(&DataKey::MintWindow(minter.clone()), &window);

        let supply = e.storage().instance().get::<_, i128>(&DataKey::Supply).unwrap();
        let new_to = Self::read_balance(&e, &to) + amount;
        Self::write_balance(&e, &to, new_to);
        e.storage().instance().set(&DataKey::Supply, &(supply + amount));
        events::emit_mint(&e, minter, to, amount);
    }

    /// Sets the verification status of an address.
    /// 
    /// # Arguments
    /// * `addr` - The address to verify.
    /// * `status` - The verification status to set.
    pub fn set_verified(e: Env, addr: Address, status: bool) {
        let admin: Address = e.storage().instance().get(&DataKey::Admin).unwrap();
        admin.require_auth();
        e.storage().persistent().set(&DataKey::Verified(addr), &status);
    }

    /// Returns whether an address is verified.
    pub fn is_verified(e: Env, addr: Address) -> bool {
        e.storage().persistent().get(&DataKey::Verified(addr)).unwrap_or(false)
    }

    /// Verifies an address using a ZK-proof or similar cryptographic proof.
    pub fn verify_with_proof(e: Env, addr: Address, proof: Bytes) {
        // Mock ZK-Proof verification logic
        if proof.len() > 0 {
            e.storage().persistent().set(&DataKey::Verified(addr), &true);
        }
    }

    pub fn take_snapshot(e: Env) -> u32 {
        let admin: Address = e.storage().instance().get(&DataKey::Admin).unwrap();
        admin.require_auth();
        let sequence = e.ledger().sequence();
        let supply = e.storage().instance().get::<_, i128>(&DataKey::Supply).unwrap();
        e.storage().persistent().set(&DataKey::SupplySnapshot(sequence), &supply);
        sequence
    }

    pub fn record_balance_snapshot(e: Env, id: Address) {
        let sequence = e.ledger().sequence();
        let balance = Self::read_balance(&e, &id);
        e.storage().persistent().set(&DataKey::Snapshot(id, sequence), &balance);
    }

    /// Returns the balance of an account at a specific ledger sequence.
    pub fn get_balance_at(e: Env, id: Address, sequence: u32) -> i128 {
        e.storage().persistent().get(&DataKey::Snapshot(id, sequence)).unwrap_or(0)
    }

    /// Returns the total supply at a specific ledger sequence.
    pub fn get_supply_at(e: Env, sequence: u32) -> i128 {
        e.storage().persistent().get(&DataKey::SupplySnapshot(sequence)).unwrap_or(0)
    }

    /// Set the maximum tokens a Minter role address may mint within any rolling 24-hour window.
    pub fn set_minter_limit(e: Env, minter: Address, limit: i128) {
        soromint_lifecycle::require_not_paused(&e);
        let admin: Address = e.storage().instance().get(&DataKey::Admin).unwrap();
        admin.require_auth();
        if limit <= 0 { panic!("limit must be positive"); }
        e.storage().persistent().set(&DataKey::MintLimit(minter), &limit);
    }

    /// Returns the configured 24-hour mint limit for a minter, or None if unset.
    pub fn minter_limit(e: Env, minter: Address) -> Option<i128> {
        e.storage().persistent().get(&DataKey::MintLimit(minter))
    }

    /// Mint tokens as a Minter role address, subject to the rolling 24-hour cap.
    pub fn minter_mint(e: Env, minter: Address, to: Address, amount: i128) {
        soromint_lifecycle::require_not_paused(&e);
        if amount <= 0 { panic!("mint amount must be positive"); }
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

        if now >= state.window_start + WINDOW {
            state = MintWindowState { minted: 0, window_start: now };
        }

        if state.minted + amount > limit {
            panic!("minting limit exceeded for period");
        }

        state.minted += amount;
        e.storage().persistent().set(&DataKey::MintWindow(minter.clone()), &state);

        let mut balance = Self::read_balance(&e, &to);
        balance += amount;
        Self::write_balance(&e, &to, balance);

        let mut supply: i128 = e.storage().instance().get(&DataKey::Supply).unwrap_or(0);
        supply += amount;
        e.storage().instance().set(&DataKey::Supply, &supply);

        events::emit_minter_mint(&e, &minter, &to, amount, balance, supply);
    }

    /// Record the current balance of `account` at the current ledger sequence.
    /// Anyone may call this; it is a read-then-write with no auth requirement.
    pub fn take_snapshot(e: Env, account: Address) -> u32 {
        let ledger = e.ledger().sequence();
        let balance = Self::read_balance(&e, &account);
        e.storage()
            .persistent()
            .set(&DataKey::Snapshot(account.clone(), ledger), &balance);
        events::emit_snapshot_taken(&e, &account, ledger, balance);
        ledger
    }


    /// Returns the total token supply.
    pub fn supply(e: Env) -> i128 {
        let info: TokenInfo = e.storage().instance().get(&DataKey::TokenInfo).expect("Not initialized");
        info.supply
    }

    /// Transfers the admin (owner) role to a new address.
    pub fn transfer_ownership(e: Env, new_admin: Address) {
        let mut info: TokenInfo = e.storage().instance().get(&DataKey::TokenInfo).expect("Not initialized");
        info.admin.require_auth();

        let prev_admin = info.admin.clone();
        info.admin = new_admin.clone();
        e.storage().instance().set(&DataKey::TokenInfo, &info);

        // Issue #493: Mandatory Event Logging
        events::emit_ownership_transfer(&e, &prev_admin, &new_admin);
    }
}


#[cfg(test)]
mod test;
    /// Return the balance recorded for `account` at `ledger`, or None if no snapshot exists.
    pub fn snapshot_balance(e: Env, account: Address, ledger: u32) -> Option<i128> {
        e.storage()
            .persistent()
            .get(&DataKey::Snapshot(account, ledger))
    }

    /// Record the total supply at the current ledger sequence.
    /// Admin-only to prevent spam.
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

    /// Return the total supply recorded at `ledger`, or None if no snapshot exists.
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
        from.require_auth();
        Self::write_allowance(&e, &from, &spender, amount);
        events::emit_approve(&e, from, spender, amount, expiration_ledger);
    }

    fn balance(e: Env, id: Address) -> i128 {
        Self::read_balance(&e, &id)
    }

    fn transfer(e: Env, from: Address, to: Address, amount: i128) {
        from.require_auth();
        if !e.storage().instance().get::<_, bool>(&DataKey::Transferable).unwrap_or(true) {
            panic!("transfers are disabled");
        }
        let (new_from, new_to) = Self::move_balance(&e, &from, &to, amount);
        events::emit_transfer(&e, from, to, amount);
    }

    fn transfer_from(e: Env, spender: Address, from: Address, to: Address, amount: i128) {
        spender.require_auth();
        if !e.storage().instance().get::<_, bool>(&DataKey::Transferable).unwrap_or(true) {
            panic!("transfers are disabled");
        }
        let allowance = Self::read_allowance(&e, &from, &spender);
        if allowance < amount { panic!("insufficient allowance"); }
        Self::write_allowance(&e, &from, &spender, allowance - amount);
        let (new_from, new_to) = Self::move_balance(&e, &from, &to, amount);
        events::emit_transfer(&e, from, to, amount);
    }

    fn burn(e: Env, from: Address, amount: i128) {
        from.require_auth();
        let balance = Self::read_balance(&e, &from);
        if balance < amount { panic!("insufficient balance"); }
        let supply = e.storage().instance().get::<_, i128>(&DataKey::Supply).unwrap();
        Self::write_balance(&e, &from, balance - amount);
        e.storage().instance().set(&DataKey::Supply, &(supply - amount));
        events::emit_burn(&e, from, amount);
    }

    fn burn_from(e: Env, spender: Address, from: Address, amount: i128) {
        spender.require_auth();
        let allowance = Self::read_allowance(&e, &from, &spender);
        if allowance < amount { panic!("insufficient allowance"); }
        let balance = Self::read_balance(&e, &from);
        if balance < amount { panic!("insufficient balance"); }
        let supply = e.storage().instance().get::<_, i128>(&DataKey::Supply).unwrap();
        Self::write_allowance(&e, &from, &spender, allowance - amount);
        Self::write_balance(&e, &from, balance - amount);
        e.storage().instance().set(&DataKey::Supply, &(supply - amount));
        events::emit_burn(&e, from, amount);
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
