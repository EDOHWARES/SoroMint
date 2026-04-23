#![no_std]

mod events;

#[cfg(test)]
mod test;

use soroban_sdk::{contract, contractimpl, contracttype, symbol_short, Address, Env, String, Vec, Symbol, BytesN};

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Signers,
    Threshold,
    PendingTx(u64),
    TxCounter,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PendingTransaction {
    pub id: u64,
    pub target: Address,
    pub function: Symbol,
    pub args: Vec<u8>,
    pub signatures: Vec<Address>,
    pub executed: bool,
}

#[contract]
pub struct MultiSigAdmin;

#[contractimpl]
impl MultiSigAdmin {
    pub fn initialize(e: Env, signers: Vec<Address>, threshold: u32) {
        if e.storage().instance().has(&DataKey::Signers) {
            panic!("already initialized");
        }
        if threshold == 0 || threshold > signers.len() {
            panic!("invalid threshold");
        }
        e.storage().instance().set(&DataKey::Signers, &signers);
        e.storage().instance().set(&DataKey::Threshold, &threshold);
        e.storage().instance().set(&DataKey::TxCounter, &0u64);
    }

    pub fn propose_tx(e: Env, proposer: Address, target: Address, function: Symbol, args: Vec<u8>) -> u64 {
        proposer.require_auth();
        Self::require_signer(&e, &proposer);

        let tx_id: u64 = e.storage().instance().get(&DataKey::TxCounter).unwrap_or(0);
        let next_id = tx_id + 1;

        let mut sigs = Vec::new(&e);
        sigs.push_back(proposer.clone());

        let tx = PendingTransaction {
            id: next_id,
            target,
            function,
            args,
            signatures: sigs,
            executed: false,
        };

        e.storage().persistent().set(&DataKey::PendingTx(next_id), &tx);
        e.storage().instance().set(&DataKey::TxCounter, &next_id);

        e.events().publish((symbol_short!("tx_prop"),), (next_id, proposer));
        next_id
    }

    pub fn approve_tx(e: Env, signer: Address, tx_id: u64) {
        signer.require_auth();
        Self::require_signer(&e, &signer);

        let mut tx: PendingTransaction = e.storage().persistent()
            .get(&DataKey::PendingTx(tx_id))
            .expect("transaction not found");

        if tx.executed {
            panic!("transaction already executed");
        }

        if tx.signatures.iter().any(|s| s == signer) {
            panic!("already signed");
        }

        tx.signatures.push_back(signer.clone());
        e.storage().persistent().set(&DataKey::PendingTx(tx_id), &tx);

        e.events().publish((symbol_short!("tx_appr"),), (tx_id, signer));
    }

    pub fn execute_tx(e: Env, executor: Address, tx_id: u64) {
        executor.require_auth();
        Self::require_signer(&e, &executor);

        let mut tx: PendingTransaction = e.storage().persistent()
            .get(&DataKey::PendingTx(tx_id))
            .expect("transaction not found");

        if tx.executed {
            panic!("transaction already executed");
        }

        let threshold: u32 = e.storage().instance().get(&DataKey::Threshold).unwrap();
        if tx.signatures.len() < threshold {
            panic!("insufficient signatures");
        }

        tx.executed = true;
        e.storage().persistent().set(&DataKey::PendingTx(tx_id), &tx);

        e.events().publish((symbol_short!("tx_exec"),), (tx_id, executor));
    }

    pub fn get_tx(e: Env, tx_id: u64) -> PendingTransaction {
        e.storage().persistent()
            .get(&DataKey::PendingTx(tx_id))
            .expect("transaction not found")
    }

    pub fn get_signers(e: Env) -> Vec<Address> {
        e.storage().instance().get(&DataKey::Signers).unwrap()
    }

    pub fn get_threshold(e: Env) -> u32 {
        e.storage().instance().get(&DataKey::Threshold).unwrap()
    }

    fn require_signer(e: &Env, addr: &Address) {
        let signers: Vec<Address> = e.storage().instance().get(&DataKey::Signers).unwrap();
        if !signers.iter().any(|s| s == *addr) {
            panic!("not a signer");
        }
    }

    pub fn version(e: Env) -> String {
        String::from_str(&e, "1.0.0")
    }

    pub fn status(e: Env) -> String {
        String::from_str(&e, "alive")
    }
}
