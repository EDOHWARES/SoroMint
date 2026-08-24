#![no_std]

mod events;

#[cfg(test)]
mod test;

use soroban_sdk::{
    contract, contractimpl, contracttype, symbol_short, Address, Bytes, BytesN, Env, IntoVal,
    String, Symbol, Vec,
};

#[contracttype]
pub enum ConfigKey {
    Signers,
    Threshold,
    TxCounter,
}

#[contracttype]
pub enum DataKey {
    Config(ConfigKey),
    PendingTx(u64),
    UpgradeProposal(u64),
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PendingTransaction {
    pub id: u64,
    pub target: Address,
    pub function: Symbol,
    pub args: Bytes,
    pub signatures: Vec<Address>,
    pub executed: bool,
}

/// A typed upgrade proposal. Execution queues `UpgradeProxy` on the Timelock;
/// the actual WASM swap happens only after the 48-hour delay.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct UpgradeProposal {
    pub id: u64,
    pub timelock: Address,
    pub proxy: Address,
    pub wasm_hash: BytesN<32>,
    pub signatures: Vec<Address>,
    pub queued: bool,
}

/// Must stay in lockstep with `soromint_timelock::FactoryOperation` (variant
/// order and field types) so `into_val` matches the timelock's decoder.
#[contracttype]
#[derive(Clone)]
#[allow(dead_code)]
enum TimelockFactoryOperation {
    UpdateWasmHash(BytesN<32>),
    UpgradeProxy(Address, BytesN<32>),
}

#[contract]
pub struct MultiSigAdmin;

#[contractimpl]
impl MultiSigAdmin {
    /// Initializes the multi-sig contract with a list of signers and a threshold.
    ///
    /// # Arguments
    /// * `signers` - A list of addresses that are authorized to sign transactions.
    /// * `threshold` - The minimum number of signatures required to execute a transaction.
    pub fn initialize(e: Env, signers: Vec<Address>, threshold: u32) {
        if e.storage()
            .instance()
            .has(&DataKey::Config(ConfigKey::Signers))
        {
            panic!("already initialized");
        }
        if threshold == 0 || threshold > signers.len() {
            panic!("invalid threshold");
        }
        e.storage()
            .instance()
            .set(&DataKey::Config(ConfigKey::Signers), &signers);
        e.storage()
            .instance()
            .set(&DataKey::Config(ConfigKey::Threshold), &threshold);
        e.storage()
            .instance()
            .set(&DataKey::Config(ConfigKey::TxCounter), &0u64);
    }

    /// Proposes a new transaction to be executed by the multi-sig contract.
    ///
    /// # Arguments
    /// * `proposer` - The address of the signer proposing the transaction.
    /// * `target` - The address of the contract to be called.
    /// * `function` - The name of the function to be called on the target contract.
    /// * `args` - The serialized arguments for the function call.
    ///
    /// # Returns
    /// The ID of the newly proposed transaction.
    pub fn propose_tx(
        e: Env,
        proposer: Address,
        target: Address,
        function: Symbol,
        args: Bytes,
    ) -> u64 {
        proposer.require_auth();
        Self::require_signer(&e, &proposer);

        let next_id = Self::next_id(&e);

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

        e.storage()
            .persistent()
            .set(&DataKey::PendingTx(next_id), &tx);

        e.events()
            .publish((symbol_short!("tx_prop"),), (next_id, proposer));
        next_id
    }

    /// Approves a pending transaction.
    ///
    /// # Arguments
    /// * `signer` - The address of the signer approving the transaction.
    /// * `tx_id` - The ID of the transaction to approve.
    pub fn approve_tx(e: Env, signer: Address, tx_id: u64) {
        signer.require_auth();
        Self::require_signer(&e, &signer);

        let mut tx: PendingTransaction = e
            .storage()
            .persistent()
            .get(&DataKey::PendingTx(tx_id))
            .expect("transaction not found");

        if tx.executed {
            panic!("transaction already executed");
        }

        if tx.signatures.iter().any(|s| s == signer) {
            panic!("already signed");
        }

        tx.signatures.push_back(signer.clone());
        e.storage()
            .persistent()
            .set(&DataKey::PendingTx(tx_id), &tx);

        e.events()
            .publish((symbol_short!("tx_appr"),), (tx_id, signer));
    }

    /// Executes a pending transaction if the threshold of signatures has been met.
    ///
    /// # Arguments
    /// * `executor` - The address of the signer executing the transaction.
    /// * `tx_id` - The ID of the transaction to execute.
    pub fn execute_tx(e: Env, executor: Address, tx_id: u64) {
        executor.require_auth();
        Self::require_signer(&e, &executor);

        let mut tx: PendingTransaction = e
            .storage()
            .persistent()
            .get(&DataKey::PendingTx(tx_id))
            .expect("transaction not found");

        if tx.executed {
            panic!("transaction already executed");
        }

        let threshold: u32 = e
            .storage()
            .instance()
            .get(&DataKey::Config(ConfigKey::Threshold))
            .unwrap();
        if tx.signatures.len() < threshold {
            panic!("insufficient signatures");
        }

        tx.executed = true;
        e.storage()
            .persistent()
            .set(&DataKey::PendingTx(tx_id), &tx);

        e.events()
            .publish((symbol_short!("tx_exec"),), (tx_id, executor));
    }

    /// Proposes a proxy WASM upgrade. The first signature is the proposer's.
    ///
    /// Execution of this proposal queues `UpgradeProxy` on `timelock`; it does
    /// **not** swap WASM immediately. The Timelock's 48-hour delay still applies.
    pub fn propose_upgrade(
        e: Env,
        proposer: Address,
        timelock: Address,
        proxy: Address,
        new_wasm_hash: BytesN<32>,
    ) -> u64 {
        proposer.require_auth();
        Self::require_signer(&e, &proposer);

        let tx_id = Self::next_id(&e);

        let mut sigs = Vec::new(&e);
        sigs.push_back(proposer.clone());

        let proposal = UpgradeProposal {
            id: tx_id,
            timelock,
            proxy,
            wasm_hash: new_wasm_hash,
            signatures: sigs,
            queued: false,
        };

        e.storage()
            .persistent()
            .set(&DataKey::UpgradeProposal(tx_id), &proposal);

        e.events()
            .publish((symbol_short!("up_prop"),), (tx_id, proposer));
        tx_id
    }

    /// Approves a pending upgrade proposal.
    pub fn approve_upgrade(e: Env, signer: Address, tx_id: u64) {
        signer.require_auth();
        Self::require_signer(&e, &signer);

        let mut proposal: UpgradeProposal = e
            .storage()
            .persistent()
            .get(&DataKey::UpgradeProposal(tx_id))
            .expect("upgrade proposal not found");

        if proposal.queued {
            panic!("upgrade already queued");
        }

        if proposal.signatures.iter().any(|s| s == signer) {
            panic!("already signed");
        }

        proposal.signatures.push_back(signer.clone());
        e.storage()
            .persistent()
            .set(&DataKey::UpgradeProposal(tx_id), &proposal);

        e.events()
            .publish((symbol_short!("up_appr"),), (tx_id, signer));
    }

    /// Queues the upgrade on the Timelock once the signature threshold is met.
    ///
    /// The Timelock admin must be this multi-sig contract so `admin.require_auth`
    /// succeeds for the cross-contract call.
    pub fn execute_upgrade(e: Env, executor: Address, tx_id: u64) {
        executor.require_auth();
        Self::require_signer(&e, &executor);

        let mut proposal: UpgradeProposal = e
            .storage()
            .persistent()
            .get(&DataKey::UpgradeProposal(tx_id))
            .expect("upgrade proposal not found");

        if proposal.queued {
            panic!("upgrade already queued");
        }

        let threshold: u32 = e
            .storage()
            .instance()
            .get(&DataKey::Config(ConfigKey::Threshold))
            .unwrap();
        if proposal.signatures.len() < threshold {
            panic!("insufficient signatures");
        }

        proposal.queued = true;
        e.storage()
            .persistent()
            .set(&DataKey::UpgradeProposal(tx_id), &proposal);

        let op = TimelockFactoryOperation::UpgradeProxy(
            proposal.proxy.clone(),
            proposal.wasm_hash.clone(),
        );
        let args = soroban_sdk::vec![&e, op.into_val(&e)];
        e.invoke_contract::<BytesN<32>>(
            &proposal.timelock,
            &Symbol::new(&e, "queue_operation"),
            args,
        );

        e.events()
            .publish((symbol_short!("up_exec"),), (tx_id, executor));
    }

    /// Returns a pending upgrade proposal.
    pub fn get_upgrade(e: Env, tx_id: u64) -> UpgradeProposal {
        e.storage()
            .persistent()
            .get(&DataKey::UpgradeProposal(tx_id))
            .expect("upgrade proposal not found")
    }

    /// Returns the details of a specific transaction.
    pub fn get_tx(e: Env, tx_id: u64) -> PendingTransaction {
        e.storage()
            .persistent()
            .get(&DataKey::PendingTx(tx_id))
            .expect("transaction not found")
    }

    /// Returns the list of authorized signers.
    pub fn get_signers(e: Env) -> Vec<Address> {
        e.storage()
            .instance()
            .get(&DataKey::Config(ConfigKey::Signers))
            .unwrap()
    }

    /// Returns the signature threshold for the multi-sig contract.
    pub fn get_threshold(e: Env) -> u32 {
        e.storage()
            .instance()
            .get(&DataKey::Config(ConfigKey::Threshold))
            .unwrap()
    }

    fn next_id(e: &Env) -> u64 {
        let tx_id: u64 = e
            .storage()
            .instance()
            .get(&DataKey::Config(ConfigKey::TxCounter))
            .unwrap_or(0);
        let next_id = tx_id + 1;
        e.storage()
            .instance()
            .set(&DataKey::Config(ConfigKey::TxCounter), &next_id);
        next_id
    }

    fn require_signer(e: &Env, addr: &Address) {
        let signers: Vec<Address> = e
            .storage()
            .instance()
            .get(&DataKey::Config(ConfigKey::Signers))
            .unwrap();
        if !signers.iter().any(|s| s == addr.clone()) {
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
