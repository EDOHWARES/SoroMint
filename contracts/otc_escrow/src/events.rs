use soroban_sdk::{symbol_short, Address, Env};

pub fn emit_trade_created(
    e: &Env,
    trade_id: u64,
    maker: &Address,
    maker_token: &Address,
    maker_amount: i128,
    taker_token: &Address,
    taker_amount: i128,
    expiration: u64,
) {
    e.events().publish(
        (symbol_short!("created"), trade_id),
        (
            maker,
            maker_token,
            maker_amount,
            taker_token,
            taker_amount,
            expiration,
        ),
    );
}

pub fn emit_trade_completed(e: &Env, trade_id: u64, maker: &Address, taker: &Address) {
    e.events()
        .publish((symbol_short!("complete"), trade_id), (maker, taker));
}

pub fn emit_trade_cancelled(e: &Env, trade_id: u64, maker: &Address) {
    e.events()
        .publish((symbol_short!("cancel"), trade_id), maker);
}

pub fn emit_trade_expired(e: &Env, trade_id: u64, maker: &Address) {
    e.events()
        .publish((symbol_short!("expired"), trade_id), maker);
}
