//! # SoroMint Token Events Module
//!
//! Provides helper functions for emitting structured Soroban events
//! for every state-changing operation in the SoroMint token contract.

use soroban_sdk::{symbol_short, Address, Env, String, Symbol};

pub fn emit_transfer(e: &Env, from: &Address, to: &Address, amount: i128, new_from_balance: i128, new_to_balance: i128) {
    let topics = (Symbol::new(e, "transfer"), from.clone(), to.clone());
    e.events().publish(topics, (amount, new_from_balance, new_to_balance));
}

pub fn emit_approve(e: &Env, from: &Address, spender: &Address, amount: i128) {
    let topics = (Symbol::new(e, "approve"), from.clone(), spender.clone());
    e.events().publish(topics, amount);
}

pub fn emit_mint(e: &Env, admin: &Address, to: &Address, amount: i128, new_balance: i128, new_supply: i128) {
    let topics = (Symbol::new(e, "mint"), admin.clone(), to.clone());
    e.events().publish(topics, (amount, new_balance, new_supply));
}

pub fn emit_burn(e: &Env, admin: &Address, from: &Address, amount: i128, new_balance: i128, new_supply: i128) {
    let topics = (Symbol::new(e, "burn"), admin.clone(), from.clone());
    e.events().publish(topics, (amount, new_balance, new_supply));
}

pub fn emit_initialized(e: &Env, admin: &Address, decimal: u32, name: &String, symbol: &String) {
    let topics = (Symbol::new(e, "init"), admin.clone());
    e.events().publish(topics, (admin.clone(), decimal, name.clone(), symbol.clone()));
}

pub fn emit_ownership_transfer(e: &Env, prev_admin: &Address, new_admin: &Address) {
    let topics = (Symbol::new(e, "owner_tx"), prev_admin.clone(), new_admin.clone());
    e.events().publish(topics, new_admin.clone());
}

pub fn emit_metadata_updated(
    env: &Env,
    admin: &Address,
    old_name: &String,
    old_symbol: &String,
    new_name: &String,
    new_symbol: &String,
) {
    let topics = (symbol_short!("SoroMint"), symbol_short!("upd_meta"));
    env.events().publish(
        topics,
        (
            admin.clone(),
            old_name.clone(),
            old_symbol.clone(),
            new_name.clone(),
            new_symbol.clone(),
        ),
    );
}

pub fn emit_fee_config_updated(e: &Env, admin: &Address, enabled: bool, fee_bps: u32, treasury: &Address) {
    let topics = (Symbol::new(e, "fee_cfg"), admin.clone());
    e.events().publish(topics, (admin.clone(), enabled, fee_bps, treasury.clone()));
}

pub fn emit_fee_collected(e: &Env, from: &Address, treasury: &Address, amount: i128) {
    let topics = (Symbol::new(e, "fee_coll"), from.clone(), treasury.clone());
    e.events().publish(topics, amount);
}

pub fn emit_transfer_from(
    e: &Env,
    spender: &Address,
    from: &Address,
    to: &Address,
    amount: i128,
    remaining_allowance: i128,
    new_from_balance: i128,
    new_to_balance: i128,
) {
    let topics = (Symbol::new(e, "tx_from"), spender.clone(), from.clone(), to.clone());
    e.events().publish(topics, (amount, remaining_allowance, new_from_balance, new_to_balance));
}

pub fn emit_minter_approved(e: &Env, owner: &Address, delegate: &Address, limit: i128) {
    let topics = (Symbol::new(e, "minter_ok"), owner.clone(), delegate.clone());
    e.events().publish(topics, limit);
}

pub fn emit_minter_revoked(e: &Env, owner: &Address, delegate: &Address) {
    let topics = (Symbol::new(e, "minter_rv"), owner.clone(), delegate.clone());
    e.events().publish(topics, ());
}

pub fn emit_delegate_mint(
    e: &Env,
    delegate: &Address,
    owner: &Address,
    to: &Address,
    amount: i128,
    new_balance: i128,
    new_supply: i128,
) {
    let topics = (Symbol::new(e, "dlg_mint"), delegate.clone(), owner.clone(), to.clone());
    e.events().publish(topics, (amount, new_balance, new_supply));
}
