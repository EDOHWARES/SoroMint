use soroban_sdk::{symbol_short, Address, Env, Symbol, Map};
use crate::storage::CollateralConfig;

pub fn emit_initialized(e: &Env, admin: &Address, smt_token: &Address, oracle: &Address) {
    let topics = (symbol_short!("init"),);
    e.events().publish(topics, (admin, smt_token, oracle));
}

pub fn emit_collateral_added(e: &Env, token: &Address, config: &CollateralConfig) {
    let topics = (symbol_short!("coll_add"),);
    e.events().publish(topics, (token, config.min_collateral_ratio, config.liquidation_threshold));
}

pub fn emit_vault_created(
    e: &Env,
    vault_id: u64,
    owner: &Address,
    collateral_token: &Address,
    collateral_amount: i128,
    debt: i128,
) {
    let topics = (symbol_short!("vlt_new"), vault_id);
    e.events().publish(topics, (owner, collateral_token, collateral_amount, debt));
}

pub fn emit_collateral_added_to_vault(
    e: &Env,
    vault_id: u64,
    token: &Address,
    amount: i128,
) {
    let topics = (symbol_short!("vlt_add"), vault_id);
    e.events().publish(topics, (token, amount));
}

pub fn emit_smt_minted(e: &Env, vault_id: u64, amount: i128, new_debt: i128) {
    let topics = (symbol_short!("smt_mint"), vault_id);
    e.events().publish(topics, (amount, new_debt));
}

pub fn emit_repay_and_withdraw(
    e: &Env,
    vault_id: u64,
    repay_amount: i128,
    token: &Address,
    withdraw_amount: i128,
) {
    let topics = (symbol_short!("vlt_rpay"), vault_id);
    e.events().publish(topics, (repay_amount, token, withdraw_amount));
}

pub fn emit_liquidation(
    e: &Env,
    vault_id: u64,
    liquidator: &Address,
    debt_covered: i128,
    collateral_seized_value: i128,
) {
    let topics = (symbol_short!("vlt_liq"), vault_id);
    e.events().publish(topics, (liquidator, debt_covered, collateral_seized_value));
}
