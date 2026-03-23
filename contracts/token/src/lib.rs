#![no_std]
use soroban_sdk::{contract, contractimpl, contracttype, Address, Env, String};

#[contracttype]
#[derive(Clone)]
enum DataKey {
    Admin,
    Supply,
    Balance(Address),
}

#[contract]
pub struct SoroMintToken;

#[contractimpl]
impl SoroMintToken {
    pub fn initialize(e: Env, admin: Address, _decimal: u32, _name: String, _symbol: String) {
        if e.storage().instance().has(&DataKey::Admin) {
            panic!("already initialized");
        }
        e.storage().instance().set(&DataKey::Admin, &admin);
        e.storage().instance().set(&DataKey::Supply, &0i128);
    }

    /// Mints `amount` tokens to `to`. Requires Admin auth.
    /// Panics if `amount <= 0` or if supply would overflow.
    pub fn mint(e: Env, to: Address, amount: i128) {
        if amount <= 0 {
            panic!("mint amount must be positive");
        }
        let admin: Address = e.storage().instance().get(&DataKey::Admin).unwrap();
        admin.require_auth();
        let balance = Self::balance(e.clone(), to.clone());
        let new_balance = balance.checked_add(amount).expect("balance overflow");
        e.storage().persistent().set(&DataKey::Balance(to), &new_balance);
        let supply: i128 = e.storage().instance().get(&DataKey::Supply).unwrap();
        let new_supply = supply.checked_add(amount).expect("supply overflow");
        e.storage().instance().set(&DataKey::Supply, &new_supply);
    }

    /// Burns `amount` tokens from `from`. Requires Admin auth.
    /// Panics if `amount <= 0`, insufficient balance, or supply underflow.
    pub fn burn(e: Env, from: Address, amount: i128) {
        if amount <= 0 {
            panic!("burn amount must be positive");
        }
        let admin: Address = e.storage().instance().get(&DataKey::Admin).unwrap();
        admin.require_auth();
        let balance = Self::balance(e.clone(), from.clone());
        if balance < amount {
            panic!("insufficient balance");
        }
        let new_balance = balance.checked_sub(amount).expect("balance underflow");
        e.storage().persistent().set(&DataKey::Balance(from), &new_balance);
        let supply: i128 = e.storage().instance().get(&DataKey::Supply).unwrap();
        let new_supply = supply.checked_sub(amount).expect("supply underflow");
        e.storage().instance().set(&DataKey::Supply, &new_supply);
    }

    /// Returns the total number of tokens currently in circulation.
    pub fn total_supply(e: Env) -> i128 {
        e.storage().instance().get(&DataKey::Supply).unwrap()
    }

    pub fn balance(e: Env, id: Address) -> i128 {
        e.storage().persistent().get(&DataKey::Balance(id)).unwrap_or(0)
    }
}

#[cfg(test)]
mod test;
