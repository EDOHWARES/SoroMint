use soroban_sdk::{symbol_short, Address, Env, Symbol};

const INIT: Symbol = symbol_short!("pool_init");
const ADD_LIQ: Symbol = symbol_short!("add_liq");
const RM_LIQ: Symbol = symbol_short!("rm_liq");
const SWAP: Symbol = symbol_short!("swap");

pub fn emit_initialized(
    e: &Env,
    factory: &Address,
    token: &Address,
    quote_token: &Address,
    fee_bps: u32,
) {
    e.events().publish(
        (INIT,),
        (factory.clone(), token.clone(), quote_token.clone(), fee_bps),
    );
}

pub fn emit_liquidity_added(
    e: &Env,
    provider: &Address,
    token_amount: i128,
    quote_amount: i128,
    shares: i128,
) {
    e.events().publish(
        (ADD_LIQ, provider.clone()),
        (token_amount, quote_amount, shares),
    );
}

pub fn emit_liquidity_removed(
    e: &Env,
    provider: &Address,
    token_amount: i128,
    quote_amount: i128,
    shares: i128,
) {
    e.events().publish(
        (RM_LIQ, provider.clone()),
        (token_amount, quote_amount, shares),
    );
}

pub fn emit_swap(
    e: &Env,
    trader: &Address,
    input_token: &Address,
    output_token: &Address,
    amount_in: i128,
    amount_out: i128,
) {
    e.events().publish(
        (
            SWAP,
            trader.clone(),
            input_token.clone(),
            output_token.clone(),
        ),
        (amount_in, amount_out),
    );
}
