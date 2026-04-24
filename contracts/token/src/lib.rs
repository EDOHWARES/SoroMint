//! # SoroMint Token Contract
//!
//! A Soroban-based token contract implementing the standard TokenInterface
//! with additional administrative controls and a configurable transfer tax.

#![no_std]

mod events;

use soroban_sdk::token::TokenInterface;
use soroban_sdk::{contract, contractimpl, contracttype, Address, Env, String, Symbol};

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
    MetadataResolver,
    FeeConfig,
    MintDelegate(Address, Address), // (owner, delegate)
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct FeeConfig {
    pub enabled: bool,
    pub fee_bps: u32, // Basis points (100 = 1%, 1000 = 10%)
    pub treasury: Address,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct MintDelegate {
    pub limit: i128,        // Maximum tokens this delegate may mint on owner's behalf
    pub minted: i128,       // Running total already minted through this delegation
    pub sponsor: Option<Address>, // If Some, this address covers the protocol fee
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
    pub fn initialize(e: Env, admin: Address, decimals: u32, name: String, symbol: String) {
        if e.storage().instance().has(&DataKey::Admin) { panic!("already initialized"); }
        e.storage().instance().set(&DataKey::Admin, &admin);
        e.storage().instance().set(&DataKey::Supply, &0i128);
        e.storage().instance().set(&DataKey::Name, &name);
        e.storage().instance().set(&DataKey::Symbol, &symbol);
        e.storage().instance().set(&DataKey::Decimals, &decimals);

        events::emit_initialized(&e, &admin, decimals, &name, &symbol);
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

    pub fn transfer_ownership(e: Env, new_admin: Address) {
        let admin: Address = e.storage().instance().get(&DataKey::Admin).unwrap();
        admin.require_auth();
        e.storage().instance().set(&DataKey::Admin, &new_admin);
        events::emit_ownership_transfer(&e, &admin, &new_admin);
    }

    /// Legacy method to set metadata hash directly. Preserved for v1 compatibility.
    pub fn set_metadata_hash(e: Env, hash: String) {
        let admin: Address = e.storage().instance().get(&DataKey::Admin).unwrap();
        admin.require_auth();
        e.storage().instance().set(&DataKey::MetadataHash, &hash);
    }

    /// Sets a resolver contract address that will provide the metadata hash.
    /// This decouples metadata storage from the core token contract.
    pub fn set_metadata_resolver(e: Env, resolver: Address) {
        let admin: Address = e.storage().instance().get(&DataKey::Admin).unwrap();
        admin.require_auth();
        e.storage().instance().set(&DataKey::MetadataResolver, &resolver);
    }

    /// Retrieves the metadata hash. Priorities the resolver if set, 
    /// otherwise falls back to the locally stored hash.
    pub fn metadata_hash(e: Env) -> Option<String> {
        if let Some(resolver) = e.storage().instance().get::<Address>(&DataKey::MetadataResolver) {
            return e.invoke_contract::<Option<String>>(
                &resolver,
                &Symbol::new(&e, "get_metadata_hash"),
                soroban_sdk::vec![&e],
            );
        }
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

    /// Extends the standard update_metadata with old/new values
    pub fn update_metadata(e: Env, new_name: String, new_symbol: String) {
        let admin: Address = e.storage().instance().get(&DataKey::Admin).unwrap();
        admin.require_auth();

        let old_name: String = e.storage().instance().get(&DataKey::Name).unwrap();
        let old_symbol: String = e.storage().instance().get(&DataKey::Symbol).unwrap();

        e.storage().instance().set(&DataKey::Name, &new_name);
        e.storage().instance().set(&DataKey::Symbol, &new_symbol);

        events::emit_metadata_updated(&e, &admin, &old_name, &old_symbol, &new_name, &new_symbol);
    }

    /// Grants `delegate` permission to mint up to `limit` tokens on behalf of `owner`.
    /// An optional `sponsor` address can be set to absorb any protocol fee instead of the owner.
    ///
    /// # Authorization
    /// Requires `owner` to authorize.
    pub fn approve_minter(
        e: Env,
        owner: Address,
        delegate: Address,
        limit: i128,
        sponsor: Option<Address>,
    ) {
        owner.require_auth();
        if limit <= 0 { panic!("limit must be positive"); }

        let key = DataKey::MintDelegate(owner.clone(), delegate.clone());
        let entry = MintDelegate { limit, minted: 0, sponsor };
        e.storage().persistent().set(&key, &entry);

        events::emit_minter_approved(&e, &owner, &delegate, limit);
    }

    /// Revokes a previously granted delegation.
    ///
    /// # Authorization
    /// Requires `owner` to authorize.
    pub fn revoke_minter(e: Env, owner: Address, delegate: Address) {
        owner.require_auth();
        let key = DataKey::MintDelegate(owner.clone(), delegate.clone());
        e.storage().persistent().remove(&key);
        events::emit_minter_revoked(&e, &owner, &delegate);
    }

    /// Mints `amount` tokens to `to` using a delegation previously approved by `owner`.
    /// If the delegation has a sponsor, any protocol fee is charged to the sponsor instead
    /// of the `owner`. The delegate's running `minted` total is updated; once it reaches
    /// `limit` the delegation is exhausted and further calls will panic.
    ///
    /// # Authorization
    /// Requires `delegate` to authorize.
    pub fn delegate_mint(
        e: Env,
        delegate: Address,
        owner: Address,
        to: Address,
        amount: i128,
    ) {
        soromint_lifecycle::require_not_paused(&e);
        delegate.require_auth();
        if amount <= 0 { panic!("mint amount must be positive"); }

        let key = DataKey::MintDelegate(owner.clone(), delegate.clone());
        let mut entry: MintDelegate = e
            .storage()
            .persistent()
            .get(&key)
            .expect("no delegation found");

        let new_minted = entry.minted.checked_add(amount).expect("overflow");
        if new_minted > entry.limit {
            panic!("delegate mint limit exceeded");
        }

        // Fee sponsorship logic 
        // If a sponsor is configured, we temporarily redirect any protocol fee
        // by crediting the fee from the sponsor's balance instead of the normal
        // fee deduction path. We do this by pre-funding the treasury from the
        // sponsor so move_balance sees a covered fee.
        if let Some(ref sponsor) = entry.sponsor {
            if let Some(fee_config) = e.storage().instance().get::<_, FeeConfig>(&DataKey::FeeConfig) {
                if fee_config.enabled && fee_config.fee_bps > 0 {
                    let fee_amount = amount
                        .checked_mul(fee_config.fee_bps as i128).unwrap()
                        .checked_div(10000).unwrap();
                    if fee_amount > 0 {
                        // Deduct fee from sponsor, credit treasury
                        let sponsor_bal = Self::read_balance(&e, sponsor);
                        if sponsor_bal < fee_amount {
                            panic!("sponsor has insufficient balance to cover fee");
                        }
                        Self::write_balance(&e, sponsor, sponsor_bal - fee_amount);
                        let treasury_bal = Self::read_balance(&e, &fee_config.treasury);
                        Self::write_balance(&e, &fee_config.treasury, treasury_bal + fee_amount);
                        events::emit_fee_collected(&e, sponsor, &fee_config.treasury, fee_amount);
                        // Mint the FULL amount to recipient (fee already settled above)
                        let mut balance = Self::read_balance(&e, &to);
                        balance += amount;
                        Self::write_balance(&e, &to, balance);
                        let mut supply: i128 = e.storage().instance().get(&DataKey::Supply).unwrap_or(0);
                        supply += amount;
                        e.storage().instance().set(&DataKey::Supply, &supply);
                        events::emit_delegate_mint(&e, &delegate, &owner, &to, amount, balance, supply);
                        entry.minted = new_minted;
                        e.storage().persistent().set(&key, &entry);
                        return;
                    }
                }
            }
        }

        // No sponsor or no fee active — standard mint path
        let mut balance = Self::read_balance(&e, &to);
        balance += amount;
        Self::write_balance(&e, &to, balance);
        let mut supply: i128 = e.storage().instance().get(&DataKey::Supply).unwrap_or(0);
        supply += amount;
        e.storage().instance().set(&DataKey::Supply, &supply);
        events::emit_delegate_mint(&e, &delegate, &owner, &to, amount, balance, supply);

        entry.minted = new_minted;
        e.storage().persistent().set(&key, &entry);
    }

    /// Returns the current delegation record, if any.
    pub fn mint_delegate(e: Env, owner: Address, delegate: Address) -> Option<MintDelegate> {
        e.storage()
            .persistent()
            .get(&DataKey::MintDelegate(owner, delegate))
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

    fn decimals(e: Env) -> u32 { e.storage().instance().get(&DataKey::Decimals).unwrap_or(7) }
    fn name(e: Env) -> String { e.storage().instance().get(&DataKey::Name).unwrap_or_else(|| String::from_str(&e, "SoroMint")) }
    fn symbol(e: Env) -> String { e.storage().instance().get(&DataKey::Symbol).unwrap_or_else(|| String::from_str(&e, "SMT")) }
}
