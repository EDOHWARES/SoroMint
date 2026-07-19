#![no_std]

//! Minimal token stub used only for factory deployment tests.
//! Matches the `initialize(admin, decimal, name, symbol)` interface expected by TokenFactory.

use soroban_sdk::{contract, contractimpl, contracttype, Address, Env, String};

#[contracttype]
#[derive(Clone)]
enum DataKey {
    Admin,
    Decimals,
    Name,
    Symbol,
    Supply,
}

#[contract]
pub struct DeployTestToken;

#[contractimpl]
impl DeployTestToken {
    pub fn initialize(e: Env, admin: Address, decimal: u32, name: String, symbol: String) {
        if e.storage().instance().has(&DataKey::Admin) {
            panic!("already initialized");
        }
        e.storage().instance().set(&DataKey::Admin, &admin);
        e.storage().instance().set(&DataKey::Decimals, &decimal);
        e.storage().instance().set(&DataKey::Name, &name);
        e.storage().instance().set(&DataKey::Symbol, &symbol);
        e.storage().instance().set(&DataKey::Supply, &0i128);
    }

    pub fn balance(_e: Env, _id: Address) -> i128 {
        0
    }

    pub fn supply(e: Env) -> i128 {
        e.storage()
            .instance()
            .get(&DataKey::Supply)
            .unwrap_or(0)
    }

    pub fn admin(e: Env) -> Address {
        e.storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("not initialized")
    }

    pub fn decimals(e: Env) -> u32 {
        e.storage()
            .instance()
            .get(&DataKey::Decimals)
            .expect("not initialized")
    }

    pub fn name(e: Env) -> String {
        e.storage()
            .instance()
            .get(&DataKey::Name)
            .expect("not initialized")
    }

    pub fn symbol(e: Env) -> String {
        e.storage()
            .instance()
            .get(&DataKey::Symbol)
            .expect("not initialized")
    }
}
