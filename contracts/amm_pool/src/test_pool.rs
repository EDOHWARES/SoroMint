#![cfg(test)]

use crate::{AmmPool, AmmPoolClient, LiquidityPosition, PoolReserves, PRICE_SCALE};
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    Address, Env, String,
};
use soromint_token::{SoroMintToken, SoroMintTokenClient};

fn advance_ledger(e: &Env, seconds: u64) {
    e.ledger().with_mut(|li| {
        li.timestamp += seconds;
        li.sequence_number += 1;
    });
}

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

fn setup_pool(
    fee_bps: u32,
) -> (
    Env,
    AmmPoolClient<'static>,
    Address,
    SoroMintTokenClient<'static>,
    Address,
    SoroMintTokenClient<'static>,
) {
    let e = Env::default();
    e.mock_all_auths();

    let factory = Address::generate(&e);
    let (token_id, token) = deploy_token(&e, "Minted Token", "MINT");
    let (quote_id, quote) = deploy_token(&e, "Wrapped XLM", "WXLM");

    let pool_id = e.register(AmmPool, ());
    let pool = AmmPoolClient::new(&e, &pool_id);
    pool.initialize(&factory, &token_id, &quote_id, &fee_bps);

    (e, pool, token_id, token, quote_id, quote)
}

#[test]
fn test_add_initial_liquidity_mints_shares() {
    let (e, pool, token_id, token, quote_id, quote) = setup_pool(30);
    let provider = Address::generate(&e);

    token.mint(&provider, &1_000i128);
    quote.mint(&provider, &4_000i128);

    let position = pool.add_liquidity(&provider, &1_000i128, &4_000i128, &1i128);

    assert_eq!(
        position,
        LiquidityPosition {
            token_amount: 1_000,
            quote_amount: 4_000,
            shares: 2_000,
        }
    );
    assert_eq!(pool.total_shares(), 2_000);
    assert_eq!(pool.share_balance(&provider), 2_000);
    assert_eq!(
        pool.reserves(),
        PoolReserves {
            token_reserve: 1_000,
            quote_reserve: 4_000,
        }
    );
    assert_eq!(token.balance(&provider), 0);
    assert_eq!(quote.balance(&provider), 0);

    let config = pool.config();
    assert_eq!(config.token, token_id);
    assert_eq!(config.quote_token, quote_id);
    assert_eq!(config.fee_bps, 30);
}

#[test]
fn test_add_liquidity_uses_existing_pool_ratio() {
    let (e, pool, _token_id, token, _quote_id, quote) = setup_pool(30);
    let first_provider = Address::generate(&e);
    let second_provider = Address::generate(&e);

    token.mint(&first_provider, &1_000i128);
    quote.mint(&first_provider, &2_000i128);
    pool.add_liquidity(&first_provider, &1_000i128, &2_000i128, &1i128);

    token.mint(&second_provider, &500i128);
    quote.mint(&second_provider, &1_500i128);

    let position = pool.add_liquidity(&second_provider, &500i128, &1_500i128, &1i128);

    assert_eq!(
        position,
        LiquidityPosition {
            token_amount: 500,
            quote_amount: 1_000,
            shares: 707,
        }
    );
    assert_eq!(token.balance(&second_provider), 0);
    assert_eq!(quote.balance(&second_provider), 500);
    assert_eq!(pool.share_balance(&second_provider), 707);
    assert_eq!(
        pool.reserves(),
        PoolReserves {
            token_reserve: 1_500,
            quote_reserve: 3_000,
        }
    );
}

#[test]
fn test_swap_updates_reserves_and_pays_out_quote_asset() {
    let (e, pool, token_id, token, _quote_id, quote) = setup_pool(30);
    let provider = Address::generate(&e);
    let trader = Address::generate(&e);

    token.mint(&provider, &1_000i128);
    quote.mint(&provider, &1_000i128);
    pool.add_liquidity(&provider, &1_000i128, &1_000i128, &1i128);

    token.mint(&trader, &100i128);
    let quote_preview = pool.quote_swap(&token_id, &100i128);
    assert_eq!(quote_preview.amount_out, 90);

    let result = pool.swap(&trader, &token_id, &100i128, &90i128);

    assert_eq!(result.amount_out, 90);
    assert_eq!(token.balance(&trader), 0);
    assert_eq!(quote.balance(&trader), 90);
    assert_eq!(
        pool.reserves(),
        PoolReserves {
            token_reserve: 1_100,
            quote_reserve: 910,
        }
    );
}

#[test]
fn test_remove_liquidity_returns_underlying_assets() {
    let (e, pool, _token_id, token, _quote_id, quote) = setup_pool(30);
    let provider = Address::generate(&e);

    token.mint(&provider, &1_000i128);
    quote.mint(&provider, &4_000i128);
    pool.add_liquidity(&provider, &1_000i128, &4_000i128, &1i128);

    let removed = pool.remove_liquidity(&provider, &500i128, &250i128, &1_000i128);

    assert_eq!(
        removed,
        LiquidityPosition {
            token_amount: 250,
            quote_amount: 1_000,
            shares: 500,
        }
    );
    assert_eq!(token.balance(&provider), 250);
    assert_eq!(quote.balance(&provider), 1_000);
    assert_eq!(pool.share_balance(&provider), 1_500);
    assert_eq!(pool.total_shares(), 1_500);
    assert_eq!(
        pool.reserves(),
        PoolReserves {
            token_reserve: 750,
            quote_reserve: 3_000,
        }
    );
}

#[test]
fn test_oracle_accumulator_updates_once_per_ledger() {
    let (e, pool, _token_id, token, _quote_id, quote) = setup_pool(30);
    let provider = Address::generate(&e);

    token.mint(&provider, &1_000i128);
    quote.mint(&provider, &4_000i128);
    pool.add_liquidity(&provider, &1_000i128, &4_000i128, &1i128);

    let before = pool.oracle_snapshot();
    let again = pool.sync_oracle();
    assert_eq!(before, again);

    advance_ledger(&e, 60);
    let after = pool.sync_oracle();
    let expected_token = 4 * PRICE_SCALE * 60;
    let expected_quote = PRICE_SCALE / 4 * 60;
    assert_eq!(
        after.price_cumulative_token - before.price_cumulative_token,
        expected_token
    );
    assert_eq!(
        after.price_cumulative_quote - before.price_cumulative_quote,
        expected_quote
    );

    let same_ledger = pool.sync_oracle();
    assert_eq!(after, same_ledger);
}

#[test]
fn test_spot_prices_match_reserve_ratio() {
    let (e, pool, _token_id, token, _quote_id, quote) = setup_pool(30);
    let provider = Address::generate(&e);

    token.mint(&provider, &1_000i128);
    quote.mint(&provider, &4_000i128);
    pool.add_liquidity(&provider, &1_000i128, &4_000i128, &1i128);

    let spots = pool.spot_prices();
    assert_eq!(spots.token_price, 4 * PRICE_SCALE);
    assert_eq!(spots.quote_price, PRICE_SCALE / 4);
}

#[test]
fn test_oracle_uses_pre_trade_reserves_across_swap() {
    let (e, pool, token_id, token, _quote_id, quote) = setup_pool(30);
    let provider = Address::generate(&e);
    let trader = Address::generate(&e);

    token.mint(&provider, &1_000i128);
    quote.mint(&provider, &1_000i128);
    pool.add_liquidity(&provider, &1_000i128, &1_000i128, &1i128);

    advance_ledger(&e, 30);
    let after_idle = pool.sync_oracle();
    assert_eq!(after_idle.price_cumulative_token, PRICE_SCALE * 30);

    token.mint(&trader, &100i128);
    pool.swap(&trader, &token_id, &100i128, &1i128);

    let spots = pool.spot_prices();
    advance_ledger(&e, 30);
    let after_swap = pool.sync_oracle();
    assert_eq!(
        after_swap.price_cumulative_token - after_idle.price_cumulative_token,
        spots.token_price * 30
    );
}
