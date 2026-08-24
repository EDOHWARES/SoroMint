//! Fuzz / property-based tests for the PriceOracle contract.
//!
//! These tests use `proptest` to generate randomised inputs and verify that:
//!  - Expected errors fire (and no unexpected panics occur) across the input space.
//!  - Arithmetic helpers (`calculate_usd_value`, `calculate_token_amount`,
//!    `is_price_stale`) behave consistently regardless of numeric values.
//!  - State invariants hold after any sequence of valid operations.

#![cfg(test)]

extern crate std;

use super::*;
use proptest::prelude::*;
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    Address, Env,
};

// ---------------------------------------------------------------------------
// Test helper macros
// ---------------------------------------------------------------------------

/// Run `$body` in a catch_unwind and return Ok/Err.
macro_rules! catch_panic {
    ($body:expr) => {
        std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| $body))
    };
}

// ---------------------------------------------------------------------------
// initialize — double-init guard
// ---------------------------------------------------------------------------

proptest! {
    /// Calling `initialize` a second time must always panic regardless of
    /// which address is passed on the second call.
    #[test]
    fn prop_double_initialize_always_panics(_seed: u64) {
        let e = Env::default();
        e.mock_all_auths();

        let admin = Address::generate(&e);
        let second = Address::generate(&e);

        let contract_id = e.register(PriceOracle, ());
        let client = PriceOracleClient::new(&e, &contract_id);
        client.initialize(&admin);

        let result = catch_panic!(client.initialize(&second));
        prop_assert!(result.is_err(), "double-initialize must panic");
    }
}

// ---------------------------------------------------------------------------
// add_trusted_source / remove_trusted_source
// ---------------------------------------------------------------------------

proptest! {
    /// After adding a source the trusted-source list length must increase by 1.
    #[test]
    fn prop_add_source_increases_count(_seed: u64) {
        let e = Env::default();
        e.mock_all_auths();
        let admin = Address::generate(&e);
        let source = Address::generate(&e);
        let contract_id = e.register(PriceOracle, ());
        let client = PriceOracleClient::new(&e, &contract_id);
        client.initialize(&admin);

        let before = client.get_trusted_sources().len();
        client.add_trusted_source(&source);
        prop_assert_eq!(client.get_trusted_sources().len(), before + 1);
    }

    /// Adding an already-trusted source must always panic.
    #[test]
    fn prop_add_duplicate_source_panics(_seed: u64) {
        let e = Env::default();
        e.mock_all_auths();
        let admin = Address::generate(&e);
        let source = Address::generate(&e);
        let contract_id = e.register(PriceOracle, ());
        let client = PriceOracleClient::new(&e, &contract_id);
        client.initialize(&admin);
        client.add_trusted_source(&source);

        let result = catch_panic!(client.add_trusted_source(&source));
        prop_assert!(result.is_err(), "duplicate add_trusted_source must panic");
    }

    /// After removing a source the list length must decrease by 1.
    #[test]
    fn prop_remove_source_decreases_count(_seed: u64) {
        let e = Env::default();
        e.mock_all_auths();
        let admin = Address::generate(&e);
        let source = Address::generate(&e);
        let contract_id = e.register(PriceOracle, ());
        let client = PriceOracleClient::new(&e, &contract_id);
        client.initialize(&admin);
        client.add_trusted_source(&source);

        let before = client.get_trusted_sources().len();
        client.remove_trusted_source(&source);
        prop_assert_eq!(client.get_trusted_sources().len(), before - 1);
    }

    /// Removing a source that was never added must panic.
    #[test]
    fn prop_remove_nonexistent_source_panics(_seed: u64) {
        let e = Env::default();
        e.mock_all_auths();
        let admin = Address::generate(&e);
        let source = Address::generate(&e);
        let contract_id = e.register(PriceOracle, ());
        let client = PriceOracleClient::new(&e, &contract_id);
        client.initialize(&admin);

        let result = catch_panic!(client.remove_trusted_source(&source));
        prop_assert!(result.is_err(), "remove non-existent source must panic");
    }

    /// Add then remove a source — list length must return to the initial value.
    #[test]
    fn prop_add_then_remove_is_idempotent(_seed: u64) {
        let e = Env::default();
        e.mock_all_auths();
        let admin = Address::generate(&e);
        let source = Address::generate(&e);
        let contract_id = e.register(PriceOracle, ());
        let client = PriceOracleClient::new(&e, &contract_id);
        client.initialize(&admin);

        let initial_len = client.get_trusted_sources().len();
        client.add_trusted_source(&source);
        client.remove_trusted_source(&source);
        prop_assert_eq!(client.get_trusted_sources().len(), initial_len);
    }
}

// ---------------------------------------------------------------------------
// report_price — authorization and price validation
// ---------------------------------------------------------------------------

proptest! {
    /// Any positive price reported by admin is stored unchanged.
    #[test]
    fn prop_report_price_positive_stored(price in 1i128..=i128::MAX) {
        let e = Env::default();
        e.mock_all_auths();
        let admin = Address::generate(&e);
        let token = Address::generate(&e);
        let contract_id = e.register(PriceOracle, ());
        let client = PriceOracleClient::new(&e, &contract_id);
        client.initialize(&admin);

        client.report_price(&admin, &token, &price, &7u32);
        prop_assert_eq!(client.get_price(&token), price);
    }

    /// Zero or negative prices must always cause a panic.
    #[test]
    fn prop_nonpositive_price_panics(price in i128::MIN..=0i128) {
        let e = Env::default();
        e.mock_all_auths();
        let admin = Address::generate(&e);
        let token = Address::generate(&e);
        let contract_id = e.register(PriceOracle, ());
        let client = PriceOracleClient::new(&e, &contract_id);
        client.initialize(&admin);

        let result = catch_panic!(client.report_price(&admin, &token, &price, &7u32));
        prop_assert!(result.is_err(), "non-positive price must panic");
    }

    /// An address that is neither admin nor a trusted source must never be
    /// able to report a price regardless of the price value.
    #[test]
    fn prop_unauthorized_reporter_always_panics(price in 1i128..=i128::MAX) {
        let e = Env::default();
        e.mock_all_auths();
        let admin = Address::generate(&e);
        let unauthorized = Address::generate(&e);
        let token = Address::generate(&e);
        let contract_id = e.register(PriceOracle, ());
        let client = PriceOracleClient::new(&e, &contract_id);
        client.initialize(&admin);

        let result = catch_panic!(client.report_price(&unauthorized, &token, &price, &7u32));
        prop_assert!(result.is_err(), "unauthorized reporter must panic");
    }

    /// Reporting a price multiple times must update the stored price to the
    /// latest value (last-write-wins semantics).
    #[test]
    fn prop_price_update_overwrites(
        first  in 1i128..=1_000_000i128,
        second in 1i128..=1_000_000i128,
    ) {
        let e = Env::default();
        e.mock_all_auths();
        let admin = Address::generate(&e);
        let token = Address::generate(&e);
        let contract_id = e.register(PriceOracle, ());
        let client = PriceOracleClient::new(&e, &contract_id);
        client.initialize(&admin);

        client.report_price(&admin, &token, &first, &7u32);
        client.report_price(&admin, &token, &second, &7u32);
        prop_assert_eq!(client.get_price(&token), second);
    }

    /// A trusted source (not admin) must also be able to report a price.
    #[test]
    fn prop_trusted_source_can_report(price in 1i128..=i128::MAX) {
        let e = Env::default();
        e.mock_all_auths();
        let admin = Address::generate(&e);
        let source = Address::generate(&e);
        let token = Address::generate(&e);
        let contract_id = e.register(PriceOracle, ());
        let client = PriceOracleClient::new(&e, &contract_id);
        client.initialize(&admin);

        client.add_trusted_source(&source);
        client.report_price(&source, &token, &price, &7u32);
        prop_assert_eq!(client.get_price(&token), price);
    }
}

// ---------------------------------------------------------------------------
// set_price (legacy admin setter)
// ---------------------------------------------------------------------------

proptest! {
    /// The legacy `set_price` call must store the price exactly as given for
    /// any positive price.
    #[test]
    fn prop_legacy_set_price_stored(price in 1i128..=i128::MAX) {
        let e = Env::default();
        e.mock_all_auths();
        let admin = Address::generate(&e);
        let source = Address::generate(&e);
        let token = Address::generate(&e);
        let contract_id = e.register(PriceOracle, ());
        let client = PriceOracleClient::new(&e, &contract_id);
        client.initialize(&admin);

        client.set_price(&token, &price, &source);
        prop_assert_eq!(client.get_price(&token), price);
    }

    /// `set_price` with a non-positive price must panic.
    #[test]
    fn prop_legacy_set_price_nonpositive_panics(price in i128::MIN..=0i128) {
        let e = Env::default();
        e.mock_all_auths();
        let admin = Address::generate(&e);
        let source = Address::generate(&e);
        let token = Address::generate(&e);
        let contract_id = e.register(PriceOracle, ());
        let client = PriceOracleClient::new(&e, &contract_id);
        client.initialize(&admin);

        let result = catch_panic!(client.set_price(&token, &price, &source));
        prop_assert!(result.is_err(), "non-positive set_price must panic");
    }
}

// ---------------------------------------------------------------------------
// calculate_usd_value — arithmetic correctness
// ---------------------------------------------------------------------------

proptest! {
    /// For a price with 7 decimals the formula must hold:
    ///   usd_value = token_amount * price / 10^7
    /// We restrict the ranges to avoid i128 overflow in the test itself.
    #[test]
    fn prop_calculate_usd_value_correct(
        price        in 1i128..=10_000_000i128,
        token_amount in 0i128..=1_000_000_000i128,
    ) {
        let e = Env::default();
        e.mock_all_auths();
        let admin = Address::generate(&e);
        let token = Address::generate(&e);
        let contract_id = e.register(PriceOracle, ());
        let client = PriceOracleClient::new(&e, &contract_id);
        client.initialize(&admin);

        client.report_price(&admin, &token, &price, &7u32);
        let result = client.calculate_usd_value(&token, &token_amount);

        let expected_usd = token_amount
            .checked_mul(price)
            .unwrap()
            .checked_div(10_000_000)
            .unwrap();

        prop_assert_eq!(result.token_amount, token_amount);
        prop_assert_eq!(result.usd_value, expected_usd);
        prop_assert_eq!(result.price_used, price);
    }

    /// Supplying an amount of zero must return a USD value of zero.
    #[test]
    fn prop_calculate_usd_value_zero_amount(price in 1i128..=10_000_000i128) {
        let e = Env::default();
        e.mock_all_auths();
        let admin = Address::generate(&e);
        let token = Address::generate(&e);
        let contract_id = e.register(PriceOracle, ());
        let client = PriceOracleClient::new(&e, &contract_id);
        client.initialize(&admin);

        client.report_price(&admin, &token, &price, &7u32);
        let result = client.calculate_usd_value(&token, &0i128);
        prop_assert_eq!(result.usd_value, 0i128);
    }
}

// ---------------------------------------------------------------------------
// calculate_token_amount — arithmetic correctness
// ---------------------------------------------------------------------------

proptest! {
    /// token_amount = usd_value * 10^7 / price
    #[test]
    fn prop_calculate_token_amount_correct(
        price     in 1i128..=10_000_000i128,
        usd_value in 0i128..=1_000_000i128,
    ) {
        let e = Env::default();
        e.mock_all_auths();
        let admin = Address::generate(&e);
        let token = Address::generate(&e);
        let contract_id = e.register(PriceOracle, ());
        let client = PriceOracleClient::new(&e, &contract_id);
        client.initialize(&admin);

        client.report_price(&admin, &token, &price, &7u32);
        let result = client.calculate_token_amount(&token, &usd_value);

        let expected = usd_value
            .checked_mul(10_000_000)
            .unwrap()
            .checked_div(price)
            .unwrap();

        prop_assert_eq!(result, expected);
    }

    /// For usd_value = 0 the token amount must always be 0.
    #[test]
    fn prop_calculate_token_amount_zero_usd(price in 1i128..=10_000_000i128) {
        let e = Env::default();
        e.mock_all_auths();
        let admin = Address::generate(&e);
        let token = Address::generate(&e);
        let contract_id = e.register(PriceOracle, ());
        let client = PriceOracleClient::new(&e, &contract_id);
        client.initialize(&admin);

        client.report_price(&admin, &token, &price, &7u32);
        let result = client.calculate_token_amount(&token, &0i128);
        prop_assert_eq!(result, 0i128);
    }
}

// ---------------------------------------------------------------------------
// is_price_stale — timestamp logic
// ---------------------------------------------------------------------------

proptest! {
    /// A price is stale when current_time > report_time + max_age.
    #[test]
    fn prop_price_is_stale_after_max_age(
        report_time in 0u64..=1_000_000u64,
        max_age     in 0u64..=100_000u64,
        extra       in 1u64..=100_000u64,
    ) {
        let e = Env::default();
        e.mock_all_auths();
        let admin = Address::generate(&e);
        let contract_id = e.register(PriceOracle, ());
        let client = PriceOracleClient::new(&e, &contract_id);
        client.initialize(&admin);

        e.ledger().with_mut(|li| { li.timestamp = report_time; });
        let token = Address::generate(&e);
        client.report_price(&admin, &token, &1_000_000i128, &7u32);

        let current_time = report_time.saturating_add(max_age).saturating_add(extra);
        e.ledger().with_mut(|li| { li.timestamp = current_time; });

        prop_assert!(
            client.is_price_stale(&token, &max_age),
            "price must be stale when current_time ({}) > report_time ({}) + max_age ({})",
            current_time, report_time, max_age
        );
    }

    /// A price is not stale immediately after reporting (no time elapsed).
    #[test]
    fn prop_price_not_stale_immediately_after_report(
        report_time in 0u64..=1_000_000u64,
        max_age     in 1u64..=100_000u64,
    ) {
        let e = Env::default();
        e.mock_all_auths();
        let admin = Address::generate(&e);
        let contract_id = e.register(PriceOracle, ());
        let client = PriceOracleClient::new(&e, &contract_id);
        client.initialize(&admin);

        e.ledger().with_mut(|li| { li.timestamp = report_time; });
        let token = Address::generate(&e);
        client.report_price(&admin, &token, &1_000_000i128, &7u32);

        // Clock has not advanced — price is fresh
        prop_assert!(
            !client.is_price_stale(&token, &max_age),
            "price must not be stale immediately after reporting"
        );
    }

    /// A freshly reported price with a very large max_age must not be stale.
    #[test]
    fn prop_large_max_age_never_stale(_seed: u64) {
        let e = Env::default();
        e.mock_all_auths();
        let admin = Address::generate(&e);
        let contract_id = e.register(PriceOracle, ());
        let client = PriceOracleClient::new(&e, &contract_id);
        client.initialize(&admin);

        e.ledger().with_mut(|li| { li.timestamp = 1_000; });
        let token = Address::generate(&e);
        client.report_price(&admin, &token, &1_000_000i128, &7u32);

        // Advance time by 500 seconds, but max_age is huge
        e.ledger().with_mut(|li| { li.timestamp = 1_500; });
        prop_assert!(!client.is_price_stale(&token, &u64::MAX));
    }
}

// ---------------------------------------------------------------------------
// has_price — presence invariants
// ---------------------------------------------------------------------------

proptest! {
    /// Before any price is set `has_price` must return false.
    #[test]
    fn prop_has_price_false_before_set(_seed: u64) {
        let e = Env::default();
        e.mock_all_auths();
        let admin = Address::generate(&e);
        let contract_id = e.register(PriceOracle, ());
        let client = PriceOracleClient::new(&e, &contract_id);
        client.initialize(&admin);

        let token = Address::generate(&e);
        prop_assert!(!client.has_price(&token));
    }

    /// After a valid price is set `has_price` must return true.
    #[test]
    fn prop_has_price_true_after_set(price in 1i128..=i128::MAX) {
        let e = Env::default();
        e.mock_all_auths();
        let admin = Address::generate(&e);
        let contract_id = e.register(PriceOracle, ());
        let client = PriceOracleClient::new(&e, &contract_id);
        client.initialize(&admin);

        let token = Address::generate(&e);
        client.report_price(&admin, &token, &price, &7u32);
        prop_assert!(client.has_price(&token));
    }
}

// ---------------------------------------------------------------------------
// get_price_data — data consistency
// ---------------------------------------------------------------------------

proptest! {
    /// `get_price_data` must return a struct whose `price` field matches
    /// what `get_price` returns.
    #[test]
    fn prop_price_data_consistent_with_get_price(price in 1i128..=i128::MAX) {
        let e = Env::default();
        e.mock_all_auths();
        let admin = Address::generate(&e);
        let contract_id = e.register(PriceOracle, ());
        let client = PriceOracleClient::new(&e, &contract_id);
        client.initialize(&admin);

        let token = Address::generate(&e);
        client.report_price(&admin, &token, &price, &7u32);

        let data = client.get_price_data(&token);
        prop_assert_eq!(data.price, client.get_price(&token));
    }

    /// The `source` field in `PriceData` must match the reporter address.
    #[test]
    fn prop_price_data_source_matches_reporter(price in 1i128..=i128::MAX) {
        let e = Env::default();
        e.mock_all_auths();
        let admin = Address::generate(&e);
        let source = Address::generate(&e);
        let token = Address::generate(&e);
        let contract_id = e.register(PriceOracle, ());
        let client = PriceOracleClient::new(&e, &contract_id);
        client.initialize(&admin);

        client.add_trusted_source(&source);
        client.report_price(&source, &token, &price, &7u32);

        let data = client.get_price_data(&token);
        prop_assert_eq!(data.source, source);
    }

    /// The `decimals` field in `PriceData` must match what was submitted.
    #[test]
    fn prop_price_data_decimals_preserved(
        price    in 1i128..=i128::MAX,
        decimals in 0u32..=18u32,
    ) {
        let e = Env::default();
        e.mock_all_auths();
        let admin = Address::generate(&e);
        let token = Address::generate(&e);
        let contract_id = e.register(PriceOracle, ());
        let client = PriceOracleClient::new(&e, &contract_id);
        client.initialize(&admin);

        client.report_price(&admin, &token, &price, &decimals);
        let data = client.get_price_data(&token);
        prop_assert_eq!(data.decimals, decimals);
    }
}

// ---------------------------------------------------------------------------
// version — constant value
// ---------------------------------------------------------------------------

proptest! {
    /// `version()` must always return "2.0.0" regardless of contract state.
    #[test]
    fn prop_version_always_200(_seed: u64) {
        let e = Env::default();
        e.mock_all_auths();
        let admin = Address::generate(&e);
        let contract_id = e.register(PriceOracle, ());
        let client = PriceOracleClient::new(&e, &contract_id);
        client.initialize(&admin);

        let v = client.version();
        let mut buf = [0u8; 8];
        let len = v.len() as usize;
        v.copy_into_slice(&mut buf[..len]);
        prop_assert_eq!(&buf[..len], b"2.0.0");
    }
}
