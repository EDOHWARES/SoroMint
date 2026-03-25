#![no_std]
use soroban_sdk::{contract, contractimpl, contracttype, token, Address, Env, String};
use soroban_sdk::token::TokenInterface;

mod events;

#[cfg(test)]
mod test;

#[contracttype]
#[derive(Clone)]
enum DataKey {
    Admin,
    Supply,
    Balance(Address),
    Allowance(Address, Address),
    Decimals,
    Name,
    Symbol,
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
        e.storage().instance().set(&DataKey::Decimals, &decimal);
        e.storage().instance().set(&DataKey::Name, &name);
        e.storage().instance().set(&DataKey::Symbol, &symbol);

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

        let mut balance: i128 = e.storage()
            .persistent()
            .get(&DataKey::Balance(to.clone()))
            .unwrap_or(0);
        balance = balance.checked_add(amount).expect("balance overflow");
        e.storage()
            .persistent()
            .set(&DataKey::Balance(to.clone()), &balance);

        let mut supply: i128 = e.storage().instance().get(&DataKey::Supply).unwrap_or(0);
        supply = supply.checked_add(amount).expect("supply overflow");
        e.storage().instance().set(&DataKey::Supply, &supply);

        events::emit_mint(&e, &admin, &to, amount, balance, supply);
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

    /// Returns the total token supply.
    ///
    /// # Returns
    /// The current total supply of minted tokens.
    pub fn supply(e: Env) -> i128 {
        e.storage().instance().get(&DataKey::Supply).unwrap_or(0)
    }

    /// Returns the current version of the contract.
    ///
    /// # Returns
    /// A `String` representing the version (e.g., "1.0.0").
    pub fn version(e: Env) -> String {
        String::from_str(&e, "1.0.0")
    }

    /// Returns the health status of the contract.
    ///
    /// # Returns
    /// A `String` representing the status (e.g., "alive").
    pub fn status(e: Env) -> String {
        String::from_str(&e, "alive")
    }

    /// Pauses the token contract.
    pub fn pause(e: Env) {
        let admin: Address = e.storage().instance().get(&DataKey::Admin).unwrap();
        soromint_lifecycle::pause(e, admin);
    }

    /// Unpauses the token contract.
    pub fn unpause(e: Env) {
        let admin: Address = e.storage().instance().get(&DataKey::Admin).unwrap();
        soromint_lifecycle::unpause(e, admin);
    }
}

#[contractimpl]
impl token::TokenInterface for SoroMintToken {
    /// Returns the allowance for `spender` on `from`'s tokens.
    fn allowance(e: Env, from: Address, spender: Address) -> i128 {
        e.storage()
            .persistent()
            .get(&DataKey::Allowance(from, spender))
            .unwrap_or(0)
    }

    /// Approves `spender` to spend `amount` of `from`'s tokens.
    fn approve(e: Env, from: Address, spender: Address, amount: i128, _expiration_ledger: u32) {
        from.require_auth();
        if amount < 0 {
            panic!("approval amount must be non-negative");
        }

        e.storage()
            .persistent()
            .set(&DataKey::Allowance(from.clone(), spender.clone()), &amount);
    }

    /// Returns the token balance for a given address.
    fn balance(e: Env, id: Address) -> i128 {
        e.storage()
            .persistent()
            .get(&DataKey::Balance(id))
            .unwrap_or(0)
    }

    /// Transfers `amount` tokens from `from` to `to`.
    fn transfer(e: Env, from: Address, to: Address, amount: i128) {
        soromint_lifecycle::require_not_paused(&e);
        from.require_auth();
        if amount <= 0 {
            panic!("transfer amount must be positive");
        }

        let mut from_balance: i128 = e.storage()
            .persistent()
            .get(&DataKey::Balance(from.clone()))
            .unwrap_or(0);
        if from_balance < amount {
            panic!("insufficient balance");
        }
        from_balance -= amount;
        e.storage()
            .persistent()
            .set(&DataKey::Balance(from.clone()), &from_balance);

        let mut to_balance: i128 = e.storage()
            .persistent()
            .get(&DataKey::Balance(to.clone()))
            .unwrap_or(0);
        to_balance = to_balance.checked_add(amount).expect("balance overflow");
        e.storage()
            .persistent()
            .set(&DataKey::Balance(to.clone()), &to_balance);
    }

    /// Transfers `amount` tokens from `from` to `to` using allowance.
    fn transfer_from(e: Env, spender: Address, from: Address, to: Address, amount: i128) {
        soromint_lifecycle::require_not_paused(&e);
        spender.require_auth();
        if amount <= 0 {
            panic!("transfer amount must be positive");
        }

        let mut allowance: i128 = e.storage()
            .persistent()
            .get(&DataKey::Allowance(from.clone(), spender.clone()))
            .unwrap_or(0);
        if allowance < amount {
            panic!("insufficient allowance");
        }
        allowance -= amount;
        e.storage()
            .persistent()
            .set(&DataKey::Allowance(from.clone(), spender.clone()), &allowance);

        let mut from_balance: i128 = e.storage()
            .persistent()
            .get(&DataKey::Balance(from.clone()))
            .unwrap_or(0);
        if from_balance < amount {
            panic!("insufficient balance");
        }
        from_balance -= amount;
        e.storage()
            .persistent()
            .set(&DataKey::Balance(from.clone()), &from_balance);

        let mut to_balance: i128 = e.storage()
            .persistent()
            .get(&DataKey::Balance(to.clone()))
            .unwrap_or(0);
        to_balance = to_balance.checked_add(amount).expect("balance overflow");
        e.storage()
            .persistent()
            .set(&DataKey::Balance(to.clone()), &to_balance);
    }

    /// Burns `amount` tokens from `from`.
    fn burn(e: Env, from: Address, amount: i128) {
        soromint_lifecycle::require_not_paused(&e);
        from.require_auth();
        if amount <= 0 {
            panic!("burn amount must be positive");
        }

        let mut balance: i128 = e.storage()
            .persistent()
            .get(&DataKey::Balance(from.clone()))
            .unwrap_or(0);
        if balance < amount {
            panic!("insufficient balance");
        }
        balance -= amount;
        e.storage()
            .persistent()
            .set(&DataKey::Balance(from.clone()), &balance);

        let mut supply: i128 = e.storage().instance().get(&DataKey::Supply).unwrap_or(0);
        supply -= amount;
        e.storage().instance().set(&DataKey::Supply, &supply);

        let admin: Address = e.storage().instance().get(&DataKey::Admin).unwrap();
        events::emit_burn(&e, &admin, &from, amount, balance, supply);
    }

    /// Burns `amount` tokens from `from` using allowance.
    fn burn_from(e: Env, spender: Address, from: Address, amount: i128) {
        soromint_lifecycle::require_not_paused(&e);
        spender.require_auth();
        if amount <= 0 {
            panic!("burn amount must be positive");
        }

        let mut allowance: i128 = e.storage()
            .persistent()
            .get(&DataKey::Allowance(from.clone(), spender.clone()))
            .unwrap_or(0);
        if allowance < amount {
            panic!("insufficient allowance");
        }
        allowance -= amount;
        e.storage()
            .persistent()
            .set(&DataKey::Allowance(from.clone(), spender.clone()), &allowance);

        let mut from_balance: i128 = e.storage()
            .persistent()
            .get(&DataKey::Balance(from.clone()))
            .unwrap_or(0);
        if from_balance < amount {
            panic!("insufficient balance");
        }
        from_balance -= amount;
        e.storage()
            .persistent()
            .set(&DataKey::Balance(from.clone()), &from_balance);

        let mut supply: i128 = e.storage().instance().get(&DataKey::Supply).unwrap_or(0);
        supply -= amount;
        e.storage().instance().set(&DataKey::Supply, &supply);

        let admin: Address = e.storage().instance().get(&DataKey::Admin).unwrap();
        events::emit_burn(&e, &admin, &from, amount, from_balance, supply);
    }

    /// Returns the number of decimal places for the token.
    fn decimals(e: Env) -> u32 {
        e.storage().instance().get(&DataKey::Decimals).unwrap_or(7)
    }

    /// Returns the name of the token.
    fn name(e: Env) -> String {
        e.storage()
            .instance()
            .get(&DataKey::Name)
            .unwrap_or_else(|| String::from_str(&e, "SoroMint"))
    }

    /// Returns the symbol of the token.
    fn symbol(e: Env) -> String {
        e.storage()
            .instance()
            .get(&DataKey::Symbol)
            .unwrap_or_else(|| String::from_str(&e, "SMT"))
    }
}
