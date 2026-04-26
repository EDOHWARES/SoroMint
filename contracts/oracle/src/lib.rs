#![no_std]

mod events;

#[cfg(test)]
mod test;

use soroban_sdk::{contract, contractimpl, contracttype, Address, Env, String, Vec};

#[contracttype]
#[derive(Clone)]
enum DataKey {
    Admin,
    Price(Address),
    PriceFeeds(Address),
    LastUpdate(Address),
    TrustedSources,
    PriceHistory(Address, u64),
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PriceData {
    pub price: i128,
    pub timestamp: u64,
    pub source: Address,
    pub decimals: u32,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct USDValue {
    pub token_amount: i128,
    pub usd_value: i128,
    pub price_used: i128,
    pub timestamp: u64,
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
        
        // Initialize empty trusted sources list
        let trusted_sources: Vec<Address> = Vec::new(&e);
        e.storage().instance().set(&DataKey::TrustedSources, &trusted_sources);
    }

    /// Add a trusted price source
    pub fn add_trusted_source(e: Env, source: Address) {
        let admin: Address = e.storage().instance().get(&DataKey::Admin).unwrap();
        admin.require_auth();

        let mut sources: Vec<Address> = e
            .storage()
            .instance()
            .get(&DataKey::TrustedSources)
            .unwrap_or(Vec::new(&e));

        // Check if source already exists
        for existing in sources.iter() {
            if existing == source {
                panic!("source already trusted");
            }
        }

        sources.push_back(source.clone());
        e.storage().instance().set(&DataKey::TrustedSources, &sources);

        events::emit_source_added(&e, &source);
    }

    /// Remove a trusted price source
    pub fn remove_trusted_source(e: Env, source: Address) {
        let admin: Address = e.storage().instance().get(&DataKey::Admin).unwrap();
        admin.require_auth();

        let mut sources: Vec<Address> = e
            .storage()
            .instance()
            .get(&DataKey::TrustedSources)
            .unwrap_or(Vec::new(&e));

        let mut new_sources = Vec::new(&e);
        let mut found = false;

        for existing in sources.iter() {
            if existing != source {
                new_sources.push_back(existing);
            } else {
                found = true;
            }
        }

        if !found {
            panic!("source not found");
        }

        e.storage().instance().set(&DataKey::TrustedSources, &new_sources);

        events::emit_source_removed(&e, &source);
    }

    /// Report external price data (can be called by trusted sources or admin)
    pub fn report_price(
        e: Env,
        reporter: Address,
        token: Address,
        price: i128,
        decimals: u32,
    ) {
        reporter.require_auth();

        // Verify reporter is admin or trusted source
        let admin: Address = e.storage().instance().get(&DataKey::Admin).unwrap();
        let sources: Vec<Address> = e
            .storage()
            .instance()
            .get(&DataKey::TrustedSources)
            .unwrap_or(Vec::new(&e));

        let mut is_authorized = reporter == admin;
        if !is_authorized {
            for source in sources.iter() {
                if source == reporter {
                    is_authorized = true;
                    break;
                }
            }
        }

        if !is_authorized {
            panic!("unauthorized reporter");
        }

        if price <= 0 {
            panic!("price must be positive");
        }

        let timestamp = e.ledger().timestamp();
        let price_data = PriceData {
            price,
            timestamp,
            source: reporter.clone(),
            decimals,
        };

        e.storage()
            .persistent()
            .set(&DataKey::Price(token.clone()), &price_data);
        e.storage()
            .persistent()
            .set(&DataKey::LastUpdate(token.clone()), &timestamp);

        // Store in price history
        let history_key = DataKey::PriceHistory(token.clone(), timestamp);
        e.storage().persistent().set(&history_key, &price_data);

        events::emit_price_reported(&e, &token, price, &reporter, timestamp);
    }

    /// Legacy set_price function (admin only)
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
            decimals: 7, // Default to 7 decimals (standard for USD prices)
        };

        e.storage()
            .persistent()
            .set(&DataKey::Price(token.clone()), &price_data);
        e.storage()
            .persistent()
            .set(&DataKey::LastUpdate(token), &e.ledger().timestamp());
    }

    pub fn get_price(e: Env, token: Address) -> i128 {
        let price_data: PriceData = e
            .storage()
            .persistent()
            .get(&DataKey::Price(token))
            .expect("price not found");
        price_data.price
    }

    pub fn get_price_data(e: Env, token: Address) -> PriceData {
        e.storage()
            .persistent()
            .get(&DataKey::Price(token))
            .expect("price not found")
    }

    /// Calculate USD value for a given token amount
    pub fn calculate_usd_value(e: Env, token: Address, token_amount: i128) -> USDValue {
        let price_data: PriceData = e
            .storage()
            .persistent()
            .get(&DataKey::Price(token))
            .expect("price not found");

        // USD value = (token_amount * price) / 10^decimals
        let scale = Self::scale_factor(price_data.decimals);
        let usd_value = token_amount
            .checked_mul(price_data.price)
            .expect("overflow in USD calculation")
            .checked_div(scale)
            .expect("division error");

        USDValue {
            token_amount,
            usd_value,
            price_used: price_data.price,
            timestamp: price_data.timestamp,
        }
    }

    /// Calculate token amount needed for a target USD value
    pub fn calculate_token_amount(e: Env, token: Address, usd_value: i128) -> i128 {
        let price_data: PriceData = e
            .storage()
            .persistent()
            .get(&DataKey::Price(token))
            .expect("price not found");

        if price_data.price == 0 {
            panic!("invalid price");
        }

        // token_amount = (usd_value * 10^decimals) / price
        let scale = Self::scale_factor(price_data.decimals);
        usd_value
            .checked_mul(scale)
            .expect("overflow in token calculation")
            .checked_div(price_data.price)
            .expect("division error")
    }

    /// Get USD values for multiple tokens
    pub fn get_usd_values(e: Env, tokens: Vec<Address>, amounts: Vec<i128>) -> Vec<USDValue> {
        if tokens.len() != amounts.len() {
            panic!("tokens and amounts length mismatch");
        }

        let mut values = Vec::new(&e);
        for i in 0..tokens.len() {
            let token = tokens.get(i).unwrap();
            let amount = amounts.get(i).unwrap();
            let usd_value = Self::calculate_usd_value(e.clone(), token, amount);
            values.push_back(usd_value);
        }
        values
    }

    pub fn get_prices(e: Env, tokens: Vec<Address>) -> Vec<i128> {
        let mut prices = Vec::new(&e);
        for token in tokens.iter() {
            let price = Self::get_price(e.clone(), token);
            prices.push_back(price);
        }
        prices
    }

    /// Check if price data is stale (older than max_age seconds)
    pub fn is_price_stale(e: Env, token: Address, max_age: u64) -> bool {
        let price_data: PriceData = e
            .storage()
            .persistent()
            .get(&DataKey::Price(token))
            .expect("price not found");

        let current_time = e.ledger().timestamp();
        current_time
            .checked_sub(price_data.timestamp)
            .expect("price timestamp underflow")
            > max_age
    }

    pub fn has_price(e: Env, token: Address) -> bool {
        e.storage().persistent().has(&DataKey::Price(token))
    }

    /// Get list of trusted sources
    pub fn get_trusted_sources(e: Env) -> Vec<Address> {
        e.storage()
            .instance()
            .get(&DataKey::TrustedSources)
            .unwrap_or(Vec::new(&e))
    }

    pub fn version(e: Env) -> String {
        String::from_str(&e, "2.0.0")
    }

    fn scale_factor(decimals: u32) -> i128 {
        10i128
            .checked_pow(decimals)
            .expect("decimal scale overflow")
    }
}
