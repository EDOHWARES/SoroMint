#![cfg(test)]

use super::*;
use soroban_sdk::{
    testutils::{Address as _, Ledger, LedgerInfo},
    Address, Env,
};

#[test]
fn test_initialize() {
    let e = Env::default();
    let admin = Address::generate(&e);

    let contract_id = e.register(PriceOracle, ());
    let client = PriceOracleClient::new(&e, &contract_id);

    client.initialize(&admin);

    // Should panic on second initialization
    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        client.initialize(&admin);
    }));
    assert!(result.is_err());
}

#[test]
fn test_add_trusted_source() {
    let e = Env::default();
    e.mock_all_auths();

    let admin = Address::generate(&e);
    let source = Address::generate(&e);

    let contract_id = e.register(PriceOracle, ());
    let client = PriceOracleClient::new(&e, &contract_id);

    client.initialize(&admin);
    client.add_trusted_source(&source);

    let sources = client.get_trusted_sources();
    assert_eq!(sources.len(), 1);
    assert_eq!(sources.get(0).unwrap(), source);
}

#[test]
fn test_remove_trusted_source() {
    let e = Env::default();
    e.mock_all_auths();

    let admin = Address::generate(&e);
    let source = Address::generate(&e);

    let contract_id = e.register(PriceOracle, ());
    let client = PriceOracleClient::new(&e, &contract_id);

    client.initialize(&admin);
    client.add_trusted_source(&source);
    client.remove_trusted_source(&source);

    let sources = client.get_trusted_sources();
    assert_eq!(sources.len(), 0);
}

#[test]
fn test_report_price_by_trusted_source() {
    let e = Env::default();
    e.mock_all_auths();

    let admin = Address::generate(&e);
    let source = Address::generate(&e);
    let token = Address::generate(&e);

    let contract_id = e.register(PriceOracle, ());
    let client = PriceOracleClient::new(&e, &contract_id);

    client.initialize(&admin);
    client.add_trusted_source(&source);

    // Report price with 7 decimals (e.g., $1.50 = 15000000)
    client.report_price(&source, &token, &15000000, &7);

    let price = client.get_price(&token);
    assert_eq!(price, 15000000);

    let price_data = client.get_price_data(&token);
    assert_eq!(price_data.price, 15000000);
    assert_eq!(price_data.source, source);
    assert_eq!(price_data.decimals, 7);
}

#[test]
fn test_report_price_by_admin() {
    let e = Env::default();
    e.mock_all_auths();

    let admin = Address::generate(&e);
    let token = Address::generate(&e);

    let contract_id = e.register(PriceOracle, ());
    let client = PriceOracleClient::new(&e, &contract_id);

    client.initialize(&admin);

    // Admin can report without being in trusted sources
    client.report_price(&admin, &token, &20000000, &7);

    let price = client.get_price(&token);
    assert_eq!(price, 20000000);
}

#[test]
#[should_panic(expected = "unauthorized reporter")]
fn test_report_price_unauthorized() {
    let e = Env::default();
    e.mock_all_auths();

    let admin = Address::generate(&e);
    let unauthorized = Address::generate(&e);
    let token = Address::generate(&e);

    let contract_id = e.register(PriceOracle, ());
    let client = PriceOracleClient::new(&e, &contract_id);

    client.initialize(&admin);

    // Should panic - unauthorized reporter
    client.report_price(&unauthorized, &token, &10000000, &7);
}

#[test]
fn test_calculate_usd_value() {
    let e = Env::default();
    e.mock_all_auths();

    let admin = Address::generate(&e);
    let token = Address::generate(&e);

    let contract_id = e.register(PriceOracle, ());
    let client = PriceOracleClient::new(&e, &contract_id);

    client.initialize(&admin);

    // Set price to $2.00 (20000000 with 7 decimals)
    client.report_price(&admin, &token, &20000000, &7);

    // Calculate USD value for 100 tokens
    let usd_value = client.calculate_usd_value(&token, &100);

    // 100 tokens * $2.00 = $200
    assert_eq!(usd_value.token_amount, 100);
    assert_eq!(usd_value.usd_value, 200);
    assert_eq!(usd_value.price_used, 20000000);
}

#[test]
fn test_calculate_token_amount() {
    let e = Env::default();
    e.mock_all_auths();

    let admin = Address::generate(&e);
    let token = Address::generate(&e);

    let contract_id = e.register(PriceOracle, ());
    let client = PriceOracleClient::new(&e, &contract_id);

    client.initialize(&admin);

    // Set price to $2.00 (20000000 with 7 decimals)
    client.report_price(&admin, &token, &20000000, &7);

    // Calculate tokens needed for $200 USD
    let token_amount = client.calculate_token_amount(&token, &200);

    // $200 / $2.00 = 100 tokens
    assert_eq!(token_amount, 100);
}

#[test]
fn test_get_usd_values() {
    let e = Env::default();
    e.mock_all_auths();

    let admin = Address::generate(&e);
    let token_a = Address::generate(&e);
    let token_b = Address::generate(&e);

    let contract_id = e.register(PriceOracle, ());
    let client = PriceOracleClient::new(&e, &contract_id);

    client.initialize(&admin);

    // Set prices
    client.report_price(&admin, &token_a, &10000000, &7); // $1.00
    client.report_price(&admin, &token_b, &30000000, &7); // $3.00

    let tokens = soroban_sdk::vec![&e, token_a.clone(), token_b.clone()];
    let amounts = soroban_sdk::vec![&e, 100i128, 50i128];

    let usd_values = client.get_usd_values(&tokens, &amounts);

    assert_eq!(usd_values.len(), 2);
    assert_eq!(usd_values.get(0).unwrap().usd_value, 100); // 100 * $1.00
    assert_eq!(usd_values.get(1).unwrap().usd_value, 150); // 50 * $3.00
}

#[test]
fn test_is_price_stale() {
    let e = Env::default();
    e.mock_all_auths();

    let admin = Address::generate(&e);
    let token = Address::generate(&e);

    let contract_id = e.register(PriceOracle, ());
    let client = PriceOracleClient::new(&e, &contract_id);

    client.initialize(&admin);

    // Set initial ledger time
    e.ledger().set(LedgerInfo {
        timestamp: 1000,
        protocol_version: 20,
        sequence_number: 100,
        network_id: Default::default(),
        base_reserve: 10,
        min_temp_entry_ttl: 10,
        min_persistent_entry_ttl: 10,
        max_entry_ttl: 3110400,
    });

    client.report_price(&admin, &token, &10000000, &7);

    // Price should not be stale (max_age = 100 seconds)
    assert!(!client.is_price_stale(&token, &100));

    // Advance time by 150 seconds
    e.ledger().set(LedgerInfo {
        timestamp: 1150,
        protocol_version: 20,
        sequence_number: 200,
        network_id: Default::default(),
        base_reserve: 10,
        min_temp_entry_ttl: 10,
        min_persistent_entry_ttl: 10,
        max_entry_ttl: 3110400,
    });

    // Price should now be stale (max_age = 100 seconds)
    assert!(client.is_price_stale(&token, &100));
}

#[test]
fn test_has_price() {
    let e = Env::default();
    e.mock_all_auths();

    let admin = Address::generate(&e);
    let token = Address::generate(&e);

    let contract_id = e.register(PriceOracle, ());
    let client = PriceOracleClient::new(&e, &contract_id);

    client.initialize(&admin);

    assert!(!client.has_price(&token));

    client.report_price(&admin, &token, &10000000, &7);

    assert!(client.has_price(&token));
}

#[test]
fn test_legacy_set_price() {
    let e = Env::default();
    e.mock_all_auths();

    let admin = Address::generate(&e);
    let source = Address::generate(&e);
    let token = Address::generate(&e);

    let contract_id = e.register(PriceOracle, ());
    let client = PriceOracleClient::new(&e, &contract_id);

    client.initialize(&admin);

    // Legacy set_price should still work
    client.set_price(&token, &15000000, &source);

    let price = client.get_price(&token);
    assert_eq!(price, 15000000);

    let price_data = client.get_price_data(&token);
    assert_eq!(price_data.decimals, 7); // Default decimals
}

#[test]
#[should_panic(expected = "price must be positive")]
fn test_report_negative_price() {
    let e = Env::default();
    e.mock_all_auths();

    let admin = Address::generate(&e);
    let token = Address::generate(&e);

    let contract_id = e.register(PriceOracle, ());
    let client = PriceOracleClient::new(&e, &contract_id);

    client.initialize(&admin);

    // Should panic with negative price
    client.report_price(&admin, &token, &-10000000, &7);
}

#[test]
#[should_panic(expected = "source already trusted")]
fn test_add_duplicate_source() {
    let e = Env::default();
    e.mock_all_auths();

    let admin = Address::generate(&e);
    let source = Address::generate(&e);

    let contract_id = e.register(PriceOracle, ());
    let client = PriceOracleClient::new(&e, &contract_id);

    client.initialize(&admin);

    client.add_trusted_source(&source);
    // Should panic on duplicate
    client.add_trusted_source(&source);
}
