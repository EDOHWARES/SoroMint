use soroban_sdk::{symbol_short, Address, Env};

pub fn emit_initialized(e: &Env, admin: &Address, default_window: u64) {
    e.events().publish(
        (symbol_short!("twap_init"),),
        (admin.clone(), default_window),
    );
}

pub fn emit_pool_registered(e: &Env, pool: &Address, token: &Address, cardinality: u32) {
    e.events().publish(
        (symbol_short!("pool_reg"), pool.clone()),
        (token.clone(), cardinality),
    );
}

pub fn emit_observed(
    e: &Env,
    pool: &Address,
    timestamp: u64,
    index: u32,
    price_cumulative_token: i128,
) {
    e.events().publish(
        (symbol_short!("observe"), pool.clone()),
        (timestamp, index, price_cumulative_token),
    );
}

pub fn emit_window_set(e: &Env, window: u64) {
    e.events().publish((symbol_short!("win_set"),), window);
}
