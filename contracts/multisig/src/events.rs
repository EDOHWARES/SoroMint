use soroban_sdk::{symbol_short, Address, Env, Symbol};

const TX_PROPOSED: Symbol = symbol_short!("tx_prop");
const TX_APPROVED: Symbol = symbol_short!("tx_appr");
const TX_EXECUTED: Symbol = symbol_short!("tx_exec");

pub fn emit_tx_proposed(e: &Env, tx_id: u64, proposer: &Address) {
    e.events().publish((TX_PROPOSED,), (tx_id, proposer));
}

pub fn emit_tx_approved(e: &Env, tx_id: u64, signer: &Address) {
    e.events().publish((TX_APPROVED,), (tx_id, signer));
}

pub fn emit_tx_executed(e: &Env, tx_id: u64, executor: &Address) {
    e.events().publish((TX_EXECUTED,), (tx_id, executor));
}
