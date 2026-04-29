//! # SoroMint Wrapper Contract
//!
//! Wraps native XLM or other SAC (Stellar Asset Contract) tokens into the SoroMint standard.
//! This provides a 1:1 wrapped token with additional SoroMint-specific features like:
//! - Transfer fees
//! - Pause/unpause functionality
//! - Metadata management
//! - Event emissions
//!
//! ## Usage Flow
//! 1. User deposits underlying token (XLM or SAC token)
//! 2. Contract mints wrapped SoroMint tokens 1:1
//! 3. User can transfer wrapped tokens with SoroMint features
//! 4. User can unwrap to receive original tokens back

#![no_std]

mod events;

#[cfg(test)]
mod test;

use soroban_sdk::token::{TokenClient, TokenInterface};
use soroban_sdk::{contract, contractimpl, contracttype, Address, Env, String};

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Admin,
    UnderlyingToken,
    Allowance(Address, Address),
    Balance(Address),
    Name,
    Symbol,
    Decimals,
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
pub struct WrapperToken;

#[contractimpl]
impl WrapperToken {
    // -----------------------------------------------------------------------
    // Internal helpers
    // -----------------------------------------------------------------------

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

    /// Move balance between accounts, applying the optional transfer fee.
    /// Returns (new_from_balance, new_to_balance).
    fn move_balance(e: &Env, from: &Address, to: &Address, amount: i128) -> (i128, i128) {
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
                    .unwrap()
                    .checked_div(10000)
                    .unwrap();
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

    // -----------------------------------------------------------------------
    // Initialisation
    // -----------------------------------------------------------------------

    /// Initialize the wrapper contract.
    ///
    /// # Arguments
    /// * `admin`            - Administrator address
    /// * `underlying_token` - Address of the SAC token to wrap (e.g., native XLM)
    /// * `decimals`         - Decimal places (should match the underlying token)
    /// * `name`             - Name of the wrapped token (e.g., "Wrapped XLM")
    /// * `symbol`           - Symbol of the wrapped token (e.g., "wXLM")
    ///
    /// # Panics
    /// Panics if already initialized.
    pub fn initialize(
        e: Env,
        admin: Address,
        underlying_token: Address,
        decimals: u32,
        name: String,
        symbol: String,
    ) {
        if e.storage().instance().has(&DataKey::Admin) {
            panic!("already initialized");
        }

        e.storage().instance().set(&DataKey::Admin, &admin);
        e.storage()
            .instance()
            .set(&DataKey::UnderlyingToken, &underlying_token);
        e.storage().instance().set(&DataKey::Supply, &0i128);
        e.storage().instance().set(&DataKey::Name, &name);
        e.storage().instance().set(&DataKey::Symbol, &symbol);
        e.storage().instance().set(&DataKey::Decimals, &decimals);

        events::emit_initialized(&e, &admin, &underlying_token, decimals, &name, &symbol);
    }

    // -----------------------------------------------------------------------
    // Wrap / Unwrap
    // -----------------------------------------------------------------------

    /// Wrap underlying tokens into SoroMint wrapped tokens (1:1).
    ///
    /// # Arguments
    /// * `from`   - Address depositing the underlying tokens
    /// * `amount` - Amount of underlying tokens to wrap
    ///
    /// # Authorization
    /// Requires `from` to authorize.
    ///
    /// # Events
    /// Emits `wrap(from, amount, new_balance, new_supply)`.
    pub fn wrap(e: Env, from: Address, amount: i128) {
        soromint_lifecycle::require_not_paused(&e);
        from.require_auth();

        if amount <= 0 {
            panic!("wrap amount must be positive");
        }

        let underlying_token: Address = e
            .storage()
            .instance()
            .get(&DataKey::UnderlyingToken)
            .unwrap();
        let token_client = TokenClient::new(&e, &underlying_token);

        // Pull underlying tokens from user into this contract
        token_client.transfer(&from, &e.current_contract_address(), &amount);

        // Mint wrapped tokens to user
        let mut balance = Self::read_balance(&e, &from);
        balance = balance.checked_add(amount).unwrap();
        Self::write_balance(&e, &from, balance);

        let mut supply: i128 = e.storage().instance().get(&DataKey::Supply).unwrap_or(0);
        supply = supply.checked_add(amount).unwrap();
        e.storage().instance().set(&DataKey::Supply, &supply);

        events::emit_wrap(&e, &from, amount, balance, supply);
    }

    /// Unwrap SoroMint wrapped tokens back to the underlying token (1:1).
    ///
    /// # Arguments
    /// * `to`     - Address receiving the underlying tokens
    /// * `amount` - Amount of wrapped tokens to unwrap
    ///
    /// # Authorization
    /// Requires `to` to authorize.
    ///
    /// # Events
    /// Emits `unwrap(to, amount, new_balance, new_supply)`.
    pub fn unwrap(e: Env, to: Address, amount: i128) {
        soromint_lifecycle::require_not_paused(&e);
        to.require_auth();

        if amount <= 0 {
            panic!("unwrap amount must be positive");
        }

        let balance = Self::read_balance(&e, &to);
        if balance < amount {
            panic!("insufficient balance");
        }

        let new_balance = balance.checked_sub(amount).unwrap();
        Self::write_balance(&e, &to, new_balance);

        let mut supply: i128 = e.storage().instance().get(&DataKey::Supply).unwrap_or(0);
        supply = supply.checked_sub(amount).unwrap();
        e.storage().instance().set(&DataKey::Supply, &supply);

        // Return underlying tokens to user
        let underlying_token: Address = e
            .storage()
            .instance()
            .get(&DataKey::UnderlyingToken)
            .unwrap();
        let token_client = TokenClient::new(&e, &underlying_token);
        token_client.transfer(&e.current_contract_address(), &to, &amount);

        events::emit_unwrap(&e, &to, amount, new_balance, supply);
    }

    // -----------------------------------------------------------------------
    // View functions
    // -----------------------------------------------------------------------

    /// Returns the address of the underlying token being wrapped.
    pub fn underlying_token(e: Env) -> Address {
        e.storage()
            .instance()
            .get(&DataKey::UnderlyingToken)
            .unwrap()
    }

    pub fn supply(e: Env) -> i128 {
        e.storage().instance().get(&DataKey::Supply).unwrap_or(0)
    }

    pub fn version(e: Env) -> String {
        String::from_str(&e, "1.0.0")
    }

    pub fn status(e: Env) -> String {
        String::from_str(&e, "alive")
    }

    pub fn metadata_hash(e: Env) -> Option<String> {
        e.storage().instance().get(&DataKey::MetadataHash)
    }

    pub fn fee_config(e: Env) -> Option<FeeConfig> {
        e.storage().instance().get(&DataKey::FeeConfig)
    }

    // -----------------------------------------------------------------------
    // Admin functions
    // -----------------------------------------------------------------------

    /// Transfer admin ownership to a new address.
    pub fn transfer_ownership(e: Env, new_admin: Address) {
        let admin: Address = e.storage().instance().get(&DataKey::Admin).unwrap();
        admin.require_auth();
        e.storage().instance().set(&DataKey::Admin, &new_admin);
        events::emit_ownership_transfer(&e, &admin, &new_admin);
    }

    /// Set an IPFS or Arweave hash for external rich metadata.
    pub fn set_metadata_hash(e: Env, hash: String) {
        let admin: Address = e.storage().instance().get(&DataKey::Admin).unwrap();
        admin.require_auth();
        e.storage().instance().set(&DataKey::MetadataHash, &hash);
    }

    /// Configure the transfer fee.
    ///
    /// # Arguments
    /// * `enabled`  - Whether the fee is active
    /// * `fee_bps`  - Fee in basis points (max 1000 = 10%)
    /// * `treasury` - Address that receives collected fees
    pub fn set_fee_config(e: Env, enabled: bool, fee_bps: u32, treasury: Address) {
        let admin: Address = e.storage().instance().get(&DataKey::Admin).unwrap();
        admin.require_auth();
        if fee_bps > 1000 {
            panic!("fee percentage exceeds maximum cap of 10%");
        }
        let config = FeeConfig {
            enabled,
            fee_bps,
            treasury: treasury.clone(),
        };
        e.storage().instance().set(&DataKey::FeeConfig, &config);
        events::emit_fee_config_updated(&e, &admin, enabled, fee_bps, &treasury);
    }

    /// Pause all state-mutating operations.
    pub fn pause(e: Env) {
        let admin: Address = e.storage().instance().get(&DataKey::Admin).unwrap();
        soromint_lifecycle::pause(e, admin);
    }

    /// Unpause the contract.
    pub fn unpause(e: Env) {
        let admin: Address = e.storage().instance().get(&DataKey::Admin).unwrap();
        soromint_lifecycle::unpause(e, admin);
    }

    /// Update the token name and symbol.
    pub fn update_metadata(e: Env, new_name: String, new_symbol: String) {
        let admin: Address = e.storage().instance().get(&DataKey::Admin).unwrap();
        admin.require_auth();

        let old_name: String = e.storage().instance().get(&DataKey::Name).unwrap();
        let old_symbol: String = e.storage().instance().get(&DataKey::Symbol).unwrap();

        e.storage().instance().set(&DataKey::Name, &new_name);
        e.storage().instance().set(&DataKey::Symbol, &new_symbol);

        events::emit_metadata_updated(&e, &admin, &old_name, &old_symbol, &new_name, &new_symbol);
    }
}

// ---------------------------------------------------------------------------
// SEP-41 TokenInterface implementation
// ---------------------------------------------------------------------------

#[contractimpl]
impl TokenInterface for WrapperToken {
    fn allowance(e: Env, from: Address, spender: Address) -> i128 {
        Self::read_allowance(&e, &from, &spender)
    }

    fn approve(e: Env, from: Address, spender: Address, amount: i128, _exp: u32) {
        from.require_auth();
        if amount < 0 {
            panic!("approval amount must be non-negative");
        }
        Self::write_allowance(&e, &from, &spender, amount);
        events::emit_approve(&e, &from, &spender, amount);
    }

    fn balance(e: Env, id: Address) -> i128 {
        Self::read_balance(&e, &id)
    }

    fn transfer(e: Env, from: Address, to: Address, amount: i128) {
        soromint_lifecycle::require_not_paused(&e);
        from.require_auth();
        if amount <= 0 {
            panic!("transfer amount must be positive");
        }
        let (nf, nt) = Self::move_balance(&e, &from, &to, amount);
        events::emit_transfer(&e, &from, &to, amount, nf, nt);
    }

    fn transfer_from(e: Env, spender: Address, from: Address, to: Address, amount: i128) {
        soromint_lifecycle::require_not_paused(&e);
        spender.require_auth();
        if amount <= 0 {
            panic!("transfer amount must be positive");
        }
        let al = Self::read_allowance(&e, &from, &spender);
        if al < amount {
            panic!("insufficient allowance");
        }
        let (nf, nt) = Self::move_balance(&e, &from, &to, amount);
        Self::write_allowance(&e, &from, &spender, al - amount);
        events::emit_transfer_from(&e, &spender, &from, &to, amount, al - amount, nf, nt);
    }

    fn burn(e: Env, from: Address, amount: i128) {
        soromint_lifecycle::require_not_paused(&e);
        from.require_auth();
        if amount <= 0 {
            panic!("burn amount must be positive");
        }
        let bal = Self::read_balance(&e, &from);
        if bal < amount {
            panic!("insufficient balance");
        }
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
        if amount <= 0 {
            panic!("burn amount must be positive");
        }
        let al = Self::read_allowance(&e, &from, &spender);
        if al < amount {
            panic!("insufficient allowance");
        }
        let bal = Self::read_balance(&e, &from);
        if bal < amount {
            panic!("insufficient balance");
        }
        Self::write_allowance(&e, &from, &spender, al - amount);
        Self::write_balance(&e, &from, bal - amount);
        let mut supply: i128 = e.storage().instance().get(&DataKey::Supply).unwrap_or(0);
        supply -= amount;
        e.storage().instance().set(&DataKey::Supply, &supply);
        let admin: Address = e.storage().instance().get(&DataKey::Admin).unwrap();
        events::emit_burn(&e, &admin, &from, amount, bal - amount, supply);
    }

    fn decimals(e: Env) -> u32 {
        e.storage()
            .instance()
            .get(&DataKey::Decimals)
            .unwrap_or(7)
    }

    fn name(e: Env) -> String {
        e.storage()
            .instance()
            .get(&DataKey::Name)
            .unwrap_or_else(|| String::from_str(&e, "Wrapped Token"))
    }

    fn symbol(e: Env) -> String {
        e.storage()
            .instance()
            .get(&DataKey::Symbol)
            .unwrap_or_else(|| String::from_str(&e, "WRAP"))
    }
}
