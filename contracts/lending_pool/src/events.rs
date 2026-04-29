use soroban_sdk::{symbol_short, Address, Env, Symbol};

const DEPOSIT: Symbol = symbol_short!("deposit");
const WITHDRAW: Symbol = symbol_short!("withdraw");
const BORROW: Symbol = symbol_short!("borrow");
const REPAY: Symbol = symbol_short!("repay");
const LIQUIDATE: Symbol = symbol_short!("liquid");

pub fn emit_deposit(e: &Env, user: &Address, asset: &Address, amount: i128) {
    e.events().publish((DEPOSIT, user, asset), amount);
}

pub fn emit_withdraw(e: &Env, user: &Address, asset: &Address, amount: i128) {
    e.events().publish((WITHDRAW, user, asset), amount);
}

pub fn emit_borrow(e: &Env, user: &Address, amount: i128) {
    e.events().publish((BORROW, user), amount);
}

pub fn emit_repay(e: &Env, user: &Address, amount: i128) {
    e.events().publish((REPAY, user), amount);
}

pub fn emit_liquidate(e: &Env, liquidator: &Address, borrower: &Address, asset: &Address, amount: i128) {
    e.events().publish((LIQUIDATE, liquidator, borrower, asset), amount);
}
