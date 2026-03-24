#![no_std]
use soroban_sdk::{contract, contractimpl, contracttype, Address, Env, String};

mod events;

#[cfg(test)]
mod test;

#[contracttype]
#[derive(Clone)]
enum DataKey {
    Admin,
    Supply,
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
}

#[contract]
pub struct SoroMintToken;

#[contractimpl]
impl SoroMintToken {
    /// Initializes the SoroMint token contract.
    ///
    /// # Arguments
    /// * `admin`   - Address that will serve as the contract administrator.
    /// * `decimal` - Number of decimal places for the token.
    /// * `name`    - Human-readable token name.
    /// * `symbol`  - Token ticker symbol.
    ///
    /// # Panics
    /// Panics if the contract has already been initialized.
    ///
    /// # Events
    /// Emits an `initialized` event with `(admin, decimal, name, symbol)`.
    pub fn initialize(e: Env, admin: Address, decimal: u32, name: String, symbol: String) {
        if e.storage().instance().has(&DataKey::Admin) {
            panic!("already initialized");
        }
        e.storage().instance().set(&DataKey::Admin, &admin);
        e.storage().instance().set(&DataKey::Supply, &0i128);
        e.storage().instance().set(&DataKey::Name, &name);
        e.storage().instance().set(&DataKey::Symbol, &symbol);
        e.storage().instance().set(&DataKey::Decimal, &decimal);

        events::emit_initialized(&e, &admin, decimal, &name, &symbol);
    }

    /// Mints new tokens to a recipient address.
    ///
    /// # Arguments
    /// * `to`     - The address receiving the newly minted tokens.
    /// * `amount` - The quantity of tokens to mint.
    ///
    /// # Authorization
    /// Requires the current admin to authorize the transaction.
    ///
    /// # Events
    /// Emits a `mint` event with `(admin, to, amount, new_balance, new_supply)`.
    pub fn mint(e: Env, to: Address, amount: i128) {
        if amount <= 0 {
            panic!("mint amount must be positive");
        }
        let admin: Address = e.storage().instance().get(&DataKey::Admin).unwrap();
        admin.require_auth();

        let mut balance = Self::balance(e.clone(), to.clone());
        balance = balance.checked_add(amount).expect("balance overflow");
        e.storage()
            .persistent()
            .set(&DataKey::Balance(to.clone()), &balance);

        let mut supply: i128 = e.storage().instance().get(&DataKey::Supply).unwrap_or(0);
        supply = supply.checked_add(amount).expect("supply overflow");
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
        let admin: Address = e.storage().instance().get(&DataKey::Admin).unwrap();
        admin.require_auth();

        let balance = Self::balance(e.clone(), from.clone());
        if balance < amount {
            panic!("insufficient balance to burn");
        }
        let new_balance = balance - amount;
        e.storage()
            .persistent()
            .set(&DataKey::Balance(from.clone()), &new_balance);

        let mut supply: i128 = e.storage().instance().get(&DataKey::Supply).unwrap();
        supply -= amount;
        e.storage().instance().set(&DataKey::Supply, &supply);

        events::emit_burn(&e, &admin, &from, amount, new_balance, supply);
    }

    /// Returns the token balance for a given address.
    ///
    /// # Arguments
    /// * `id` - The address to query.
    ///
    /// # Returns
    /// The token balance, or `0` if no balance has been recorded.
    pub fn balance(e: Env, id: Address) -> i128 {
        e.storage()
            .persistent()
            .get(&DataKey::Balance(id))
            .unwrap_or(0)
    }

    /// Returns the total token supply.
    ///
    /// # Returns
    /// The current total supply of minted tokens.
    pub fn supply(e: Env) -> i128 {
        e.storage().instance().get(&DataKey::Supply).unwrap_or(0)
    }

    /// Transfers the admin (owner) role to a new address.
    ///
    /// # Arguments
    /// * `new_admin` - The address that will become the new administrator.
    ///
    /// # Authorization
    /// Requires the current admin to authorize the transaction.
    ///
    /// # Events
    /// Emits an `ownership_transfer` event with `(prev_admin, new_admin)`.
    pub fn transfer_ownership(e: Env, new_admin: Address) {
        let prev_admin: Address = e.storage().instance().get(&DataKey::Admin).unwrap();
        prev_admin.require_auth();

        e.storage().instance().set(&DataKey::Admin, &new_admin);

        events::emit_ownership_transfer(&e, &prev_admin, &new_admin);
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
}

