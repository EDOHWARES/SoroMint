#![cfg(test)]

use crate::{TwapOracle, TwapOracleClient};
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    Address, Env, String,
};
use soromint_amm_pool::{AmmPool, AmmPoolClient, PRICE_SCALE};
use soromint_token::{SoroMintToken, SoroMintTokenClient};

fn deploy_token(e: &Env, name: &str, symbol: &str) -> (Address, SoroMintTokenClient<'static>) {
    let admin = Address::generate(e);
    let token_id = e.register(SoroMintToken, ());
    let token = SoroMintTokenClient::new(e, &token_id);
    token.initialize(
        &admin,
        &7u32,
        &String::from_str(e, name),
        &String::from_str(e, symbol),
    );
    (token_id, token)
}

fn advance_ledger(e: &Env, seconds: u64) {
    e.ledger().with_mut(|li| {
        li.timestamp += seconds;
        li.sequence_number += 1;
    });
}

fn setup() -> (
    Env,
    TwapOracleClient<'static>,
    AmmPoolClient<'static>,
    Address,
    Address,
    Address,
) {
    let e = Env::default();
    e.mock_all_auths();

    let factory = Address::generate(&e);
    let admin = Address::generate(&e);
    let (token_id, token) = deploy_token(&e, "Minted Token", "MINT");
    let (quote_id, quote) = deploy_token(&e, "USDC", "USDC");

    let pool_id = e.register(AmmPool, ());
    let pool = AmmPoolClient::new(&e, &pool_id);
    pool.initialize(&factory, &token_id, &quote_id, &30u32);

    let provider = Address::generate(&e);
    token.mint(&provider, &1_000i128);
    quote.mint(&provider, &4_000i128);
    pool.add_liquidity(&provider, &1_000i128, &4_000i128, &1i128);

    let twap_id = e.register(TwapOracle, ());
    let twap = TwapOracleClient::new(&e, &twap_id);
    twap.initialize(&admin, &900u64);
    twap.register_pool(&pool_id, &16u32, &1u32);

    (e, twap, pool, token_id, quote_id, admin)
}

#[test]
fn test_twap_matches_constant_spot_over_window() {
    let (e, twap, _pool, token_id, _quote_id, _admin) = setup();

    advance_ledger(&e, 900);
    let result = twap.consult(&twap.get_pool(&token_id), &900u64);

    assert_eq!(result.token_price, 4 * PRICE_SCALE);
    assert_eq!(result.quote_price, PRICE_SCALE / 4);
    assert_eq!(result.window, 900);
    assert_eq!(twap.get_price(&token_id), 4 * PRICE_SCALE);
    assert!(twap.has_twap(&token_id));
}

#[test]
fn test_twap_averages_two_equal_price_periods() {
    let (e, twap, pool, token_id, _quote_id, _admin) = setup();
    let trader = Address::generate(&e);

    advance_ledger(&e, 900);
    twap.observe(&pool.address);

    let token = SoroMintTokenClient::new(&e, &token_id);
    token.mint(&trader, &1_000i128);
    pool.swap(&trader, &token_id, &1_000i128, &1i128);

    let after_swap = pool.spot_prices();
    advance_ledger(&e, 900);

    let result = twap.consult(&pool.address, &1_800u64);
    let expected = ((4 * PRICE_SCALE) + after_swap.token_price) / 2;
    let delta = (result.token_price - expected).abs();
    assert!(
        delta <= 1,
        "twap {} vs expected {}",
        result.token_price,
        expected
    );
}

#[test]
#[should_panic(expected = "insufficient observation history")]
fn test_consult_requires_full_window() {
    let (e, twap, pool, _token_id, _quote_id, _admin) = setup();
    advance_ledger(&e, 30);
    twap.consult(&pool.address, &900u64);
}

#[test]
fn test_ring_buffer_wrap_still_consults() {
    let (e, twap, pool, token_id, _quote_id, _admin) = setup();

    for _ in 0..20 {
        advance_ledger(&e, 60);
        twap.observe(&pool.address);
    }

    let feed = twap.get_feed(&pool.address);
    assert_eq!(feed.count, 16);
    assert_eq!(feed.cardinality, 16);

    let result = twap.consult(&pool.address, &900u64);
    assert_eq!(result.token_price, 4 * PRICE_SCALE);
    assert!(twap.has_twap_window(&token_id, &900u64));
}

#[test]
fn test_has_twap_false_before_window() {
    let (_e, twap, _pool, token_id, _quote_id, _admin) = setup();
    assert!(!twap.has_twap(&token_id));
}

#[test]
fn test_set_default_window() {
    let (_e, twap, _pool, _token_id, _quote_id, admin) = setup();
    let _ = admin;
    twap.set_default_window(&1_800u64);
    assert_eq!(twap.default_window(), 1_800);
}
