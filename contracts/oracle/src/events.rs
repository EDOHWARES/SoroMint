use soroban_sdk::{symbol_short, Address, Env};

pub fn emit_price_reported(e: &Env, token: &Address, price: i128, reporter: &Address, timestamp: u64) {
    e.events().publish(
        (symbol_short!("price"), token),
        (price, reporter, timestamp),
    );
}

pub fn emit_source_added(e: &Env, source: &Address) {
    e.events().publish((symbol_short!("src_add"),), source);
}

pub fn emit_source_removed(e: &Env, source: &Address) {
    e.events().publish((symbol_short!("src_rm"),), source);
}
