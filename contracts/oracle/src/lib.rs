#![no_std]

use soroban_sdk::{contract, contractimpl, contracttype, Address, Env, String, Vec, Map};

#[contracttype]
#[derive(Clone)]
enum DataKey {
    Admin,
    Price(Address),
    PriceFeeds(Address),
    LastUpdate(Address),
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct PriceData {
    pub price: i128,
    pub timestamp: u64,
    pub source: Address,
}

#[contract]
pub struct PriceOracle;

#[contractimpl]
impl PriceOracle {
    pub fn initialize(e: Env, admin: Address) {
        if e.storage().instance().has(&DataKey::Admin) {
            panic!("already initialized");
        }
        e.storage().instance().set(&DataKey::Admin, &admin);
    }

    pub fn set_price(e: Env, token: Address, price: i128, source: Address) {
        let admin: Address = e.storage().instance().get(&DataKey::Admin).unwrap();
        admin.require_auth();

        if price <= 0 {
            panic!("price must be positive");
        }

        let price_data = PriceData {
            price,
            timestamp: e.ledger().timestamp(),
            source,
        };

        e.storage().persistent().set(&DataKey::Price(token.clone()), &price_data);
        e.storage().persistent().set(&DataKey::LastUpdate(token), &e.ledger().timestamp());
    }

    pub fn get_price(e: Env, token: Address) -> i128 {
        let price_data: PriceData = e.storage().persistent()
            .get(&DataKey::Price(token))
            .expect("price not found");
        price_data.price
    }

    pub fn get_price_data(e: Env, token: Address) -> PriceData {
        e.storage().persistent()
            .get(&DataKey::Price(token))
            .expect("price not found")
    }

    pub fn get_prices(e: Env, tokens: Vec<Address>) -> Vec<i128> {
        let mut prices = Vec::new(&e);
        for token in tokens.iter() {
            let price = Self::get_price(e.clone(), token);
            prices.push_back(price);
        }
        prices
    }

    pub fn has_price(e: Env, token: Address) -> bool {
        e.storage().persistent().has(&DataKey::Price(token))
    }

    pub fn version(e: Env) -> String {
        String::from_str(&e, "1.0.0")
    }
}
