use soroban_sdk::{contracttype, Env};

use crate::pool::DataKey;

/// Price scale matching the 7-decimal convention used by the push oracle and vault.
pub const PRICE_SCALE: i128 = 10_000_000;

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct OracleSnapshot {
    /// Cumulative quote-per-token price (PRICE_SCALE decimals) × seconds.
    pub price_cumulative_token: i128,
    /// Cumulative token-per-quote price (PRICE_SCALE decimals) × seconds.
    pub price_cumulative_quote: i128,
    pub last_timestamp: u64,
    pub last_ledger: u32,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SpotPrices {
    /// Quote tokens per 1 base token, PRICE_SCALE decimals.
    pub token_price: i128,
    /// Base tokens per 1 quote token, PRICE_SCALE decimals.
    pub quote_price: i128,
}

pub fn compute_spot_prices(token_reserve: i128, quote_reserve: i128) -> SpotPrices {
    if token_reserve <= 0 || quote_reserve <= 0 {
        return SpotPrices {
            token_price: 0,
            quote_price: 0,
        };
    }

    SpotPrices {
        token_price: quote_reserve
            .checked_mul(PRICE_SCALE)
            .expect("spot token price overflow")
            .checked_div(token_reserve)
            .expect("spot token price division failed"),
        quote_price: token_reserve
            .checked_mul(PRICE_SCALE)
            .expect("spot quote price overflow")
            .checked_div(quote_reserve)
            .expect("spot quote price division failed"),
    }
}

pub fn read_snapshot(e: &Env) -> OracleSnapshot {
    e.storage()
        .instance()
        .get(&DataKey::OracleState)
        .unwrap_or(OracleSnapshot {
            price_cumulative_token: 0,
            price_cumulative_quote: 0,
            last_timestamp: 0,
            last_ledger: 0,
        })
}

pub fn write_snapshot(e: &Env, snapshot: &OracleSnapshot) {
    e.storage().instance().set(&DataKey::OracleState, snapshot);
}

/// Record cumulative prices at most once per ledger, using the current reserves
/// (pre-trade) for any time that elapsed since the last snapshot.
pub fn sync(e: &Env, token_reserve: i128, quote_reserve: i128) -> OracleSnapshot {
    let current = read_snapshot(e);
    let now_ts = e.ledger().timestamp();
    let now_ledger = e.ledger().sequence();

    if now_ledger == current.last_ledger && current.last_ledger != 0 {
        return current;
    }

    let mut next = current.clone();
    if now_ts > current.last_timestamp && token_reserve > 0 && quote_reserve > 0 {
        let elapsed = (now_ts - current.last_timestamp) as i128;
        let spots = compute_spot_prices(token_reserve, quote_reserve);
        next.price_cumulative_token = current
            .price_cumulative_token
            .checked_add(
                spots
                    .token_price
                    .checked_mul(elapsed)
                    .expect("token cumulative multiplication overflow"),
            )
            .expect("token cumulative addition overflow");
        next.price_cumulative_quote = current
            .price_cumulative_quote
            .checked_add(
                spots
                    .quote_price
                    .checked_mul(elapsed)
                    .expect("quote cumulative multiplication overflow"),
            )
            .expect("quote cumulative addition overflow");
    }

    next.last_timestamp = now_ts;
    next.last_ledger = now_ledger;
    write_snapshot(e, &next);
    next
}
