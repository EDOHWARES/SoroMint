//! # Multi-Signature Access Control Contract
//!
//! A Soroban contract implementing multi-signature (multi-sig) authorization
//! for high-risk administrative operations like withdrawing fees.

#![no_std]

use soroban_sdk::{contract, contractimpl, contracttype, symbol_short, Address, BytesN, Env, Vec, Symbol};

#[cfg(test)]
mod test_multisig;

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    /// The threshold required to execute a high-risk operation
    Threshold,
    /// The list of authorized signers
    Signers,
    /// Pending operations waiting for required approvals
    PendingOp(BytesN<32>),
    /// Tracks which signers have approved a specific operation
    Approvals(BytesN<32>, Address),
}

#[contracttype]
#[derive(Clone)]
pub struct MultiSigConfig {
    pub threshold: u32,
    pub signers: Vec<Address>,
}

#[contracttype]
#[derive(Clone)]
pub struct Operation {
    pub id: BytesN<32>,
    pub action: Symbol,
    pub proposer: Address,
    pub executed: bool,
}

const OP_CREATED: Symbol = symbol_short!("op_crt");
const OP_APPROVED: Symbol = symbol_short!("op_apr");
const OP_EXECUTED: Symbol = symbol_short!("op_exe");

/// The Multi-Signature Access Control Contract
#[contract]
pub struct MultiSigAccessControl;

#[contractimpl]
impl MultiSigAccessControl {
    /// Initializes the multi-sig contract with a list of signers and a threshold.
    ///
    /// # Arguments
    /// * `signers`   - A vector of addresses that can sign operations.
    /// * `threshold` - The minimum number of signatures required to execute an operation.
    ///
    /// # Panics
    /// Panics if:
    /// - Threshold is 0 or greater than the number of signers
    /// - Contract is already initialized
    pub fn initialize(e: Env, signers: Vec<Address>, threshold: u32) {
        if e.storage().instance().has(&DataKey::Threshold) {
            panic!("already initialized");
        }

        if threshold == 0 || threshold > signers.len() {
            panic!("invalid threshold");
        }

        e.storage().instance().set(&DataKey::Signers, &signers);
        e.storage().instance().set(&DataKey::Threshold, &threshold);
    }

    /// Proposes a new high-risk operation that requires multi-sig approval.
    ///
    /// # Arguments
    /// * `operation_id` - A unique identifier for the operation (e.g., hash of operation details).
    /// * `action`       - The action to be performed (e.g., "withdraw_fees").
    /// * `proposer`     - The address proposing the operation.
    ///
    /// # Authorization
    /// Requires the proposer to be one of the authorized signers.
    pub fn propose_operation(e: Env, operation_id: BytesN<32>, action: Symbol, proposer: Address) {
        proposer.require_auth();

        // Verify proposer is a valid signer
        let signers: Vec<Address> = e.storage().instance().get(&DataKey::Signers).unwrap();
        if !signers.contains(&proposer) {
            panic!("proposer is not an authorized signer");
        }

        // Create the pending operation
        let operation = Operation {
            id: operation_id.clone(),
            action,
            proposer: proposer.clone(),
            executed: false,
        };
        e.storage().persistent().set(&DataKey::PendingOp(operation_id.clone()), &operation);

        // Record the first approval from the proposer
        e.storage().persistent().set(&DataKey::Approvals(operation_id.clone(), proposer.clone()), &true);

        // Emit event
        e.events().publish((OP_CREATED, operation_id), proposer);
    }

    /// Approves a pending operation.
    ///
    /// # Arguments
    /// * `operation_id` - The unique identifier of the operation to approve.
    /// * `approver`     - The address approving the operation.
    ///
    /// # Authorization
    /// Requires the approver to be one of the authorized signers.
    pub fn approve_operation(e: Env, operation_id: BytesN<32>, approver: Address) {
        approver.require_auth();

        // Verify approver is a valid signer
        let signers: Vec<Address> = e.storage().instance().get(&DataKey::Signers).unwrap();
        if !signers.contains(&approver) {
            panic!("approver is not an authorized signer");
        }

        // Get the pending operation
        let operation: Operation = e.storage()
            .persistent()
            .get(&DataKey::PendingOp(operation_id.clone()))
            .expect("operation not found");

        if operation.executed {
            panic!("operation already executed");
        }

        // Record the approval
        e.storage().persistent().set(&DataKey::Approvals(operation_id.clone(), approver.clone()), &true);

        // Emit event
        e.events().publish((OP_APPROVED, operation_id), approver);
    }

    /// Executes a pending operation once the threshold is met.
    ///
    /// # Arguments
    /// * `operation_id` - The unique identifier of the operation to execute.
    ///
    /// # Returns
    /// Returns `true` if the operation was executed successfully.
    ///
    /// # Panics
    /// Panics if:
    /// - The operation doesn't exist
    /// - The operation has already been executed
    /// - The approval threshold hasn't been met
    pub fn execute_operation(e: Env, operation_id: BytesN<32>) -> bool {
        // Get the pending operation
        let mut operation: Operation = e.storage()
            .persistent()
            .get(&DataKey::PendingOp(operation_id.clone()))
            .expect("operation not found");

        if operation.executed {
            panic!("operation already executed");
        }

        // Count approvals
        let signers: Vec<Address> = e.storage().instance().get(&DataKey::Signers).unwrap();
        let threshold: u32 = e.storage().instance().get(&DataKey::Threshold).unwrap();

        let mut approval_count = 0u32;
        for signer in signers.iter() {
            if e.storage()
                .persistent()
                .get::<_, bool>(&DataKey::Approvals(operation_id.clone(), signer.clone()))
                .unwrap_or(false)
            {
                approval_count += 1;
            }
        }

        if approval_count < threshold {
            panic!("insufficient approvals");
        }

        // Mark as executed
        operation.executed = true;
        e.storage().persistent().set(&DataKey::PendingOp(operation_id.clone()), &operation);

        // Emit event
        e.events().publish((OP_EXECUTED, operation_id), approval_count);

        true
    }

    /// Returns the current multi-sig configuration.
    pub fn get_config(e: Env) -> MultiSigConfig {
        let signers: Vec<Address> = e.storage().instance().get(&DataKey::Signers).unwrap();
        let threshold: u32 = e.storage().instance().get(&DataKey::Threshold).unwrap();
        MultiSigConfig { threshold, signers }
    }

    /// Returns whether an operation has been executed.
    pub fn is_executed(e: Env, operation_id: BytesN<32>) -> bool {
        e.storage()
            .persistent()
            .get::<_, Operation>(&DataKey::PendingOp(operation_id))
            .map(|op| op.executed)
            .unwrap_or(false)
    }

    /// Returns the number of approvals for a specific operation.
    pub fn get_approval_count(e: Env, operation_id: BytesN<32>) -> u32 {
        let signers: Vec<Address> = e.storage().instance().get(&DataKey::Signers).unwrap();

        let mut count = 0u32;
        for signer in signers.iter() {
            if e.storage()
                .persistent()
                .get::<_, bool>(&DataKey::Approvals(operation_id.clone(), signer.clone()))
                .unwrap_or(false)
            {
                count += 1;
            }
        }
        count
    }

    /// Returns the contract version.
    pub fn version(e: Env) -> soroban_sdk::String {
        soroban_sdk::String::from_str(&e, "1.0.0")
    }

    /// Returns the contract status.
    pub fn status(e: Env) -> soroban_sdk::String {
        soroban_sdk::String::from_str(&e, "alive")
    }
}