//! # SoroMint Timelock Contract
//!
//! A governance timelock that acts as the owner/admin of the Factory contract.
//! Any administrative change (e.g. updating the WASM hash) must be queued and
//! can only be executed after a mandatory 48-hour delay, giving the community
//! time to review and react before the change takes effect.
//!
//! ## Flow
//! 1. The Timelock admin calls `queue_operation` to schedule a factory call.
//! 2. After 48 hours have elapsed on-chain, anyone may call `execute_operation`.
//! 3. The admin may call `cancel_operation` at any time before execution.

use soroban_sdk::{
    contract, contractimpl, contracttype, symbol_short, Address, BytesN, Env, String, Symbol,
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/// 48 hours expressed in seconds.
const DELAY: u64 = 48 * 60 * 60;

// ---------------------------------------------------------------------------
// Storage keys
// ---------------------------------------------------------------------------

#[contracttype]
#[derive(Clone)]
enum DataKey {
    /// The address that can queue and cancel operations.
    Admin,
    /// Stores the scheduled execution timestamp for a given operation id.
    /// Value: u64 (ledger timestamp after which execution is allowed)
    Op(BytesN<32>),
}

// ---------------------------------------------------------------------------
// Operation types
// ---------------------------------------------------------------------------

/// The set of factory operations that can be queued through the timelock.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum FactoryOperation {
    /// Update the WASM hash used by the factory for future token deployments.
    UpdateWasmHash(BytesN<32>),
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

const OP_QUEUED: Symbol = symbol_short!("op_queue");
const OP_EXECUTED: Symbol = symbol_short!("op_exec");
const OP_CANCELLED: Symbol = symbol_short!("op_cancel");

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/// Derives a deterministic 32-byte operation id from the operation payload and
/// the eta (earliest execution timestamp).  Using both fields prevents replay
/// of the same operation at a different time.
fn operation_id(e: &Env, operation: &FactoryOperation, eta: u64) -> BytesN<32> {
    // Encode the discriminant + eta into a fixed-size byte array so we can
    // hash it with the SDK's built-in SHA-256.
    let mut buf = [0u8; 40];

    // Discriminant byte
    let disc: u8 = match operation {
        FactoryOperation::UpdateWasmHash(_) => 0,
    };
    buf[0] = disc;

    // eta as big-endian u64 (8 bytes)
    let eta_bytes = eta.to_be_bytes();
    buf[1..9].copy_from_slice(&eta_bytes);

    // For UpdateWasmHash, embed the 32-byte hash starting at offset 9
    let hash_bytes = match operation {
        FactoryOperation::UpdateWasmHash(hash) => hash.to_array(),
    };
    buf[9..41].copy_from_slice(&hash_bytes);

    // SHA-256 over the 41 meaningful bytes
    e.crypto().sha256(&soroban_sdk::Bytes::from_slice(e, &buf[..41])).into()
}

// ---------------------------------------------------------------------------
// Contract
// ---------------------------------------------------------------------------

#[contract]
pub struct TimelockContract;

#[contractimpl]
impl TimelockContract {
    // -----------------------------------------------------------------------
    // Initialisation
    // -----------------------------------------------------------------------

    /// Initialises the timelock with an admin address.
    ///
    /// # Arguments
    /// * `admin` - The address that will be allowed to queue and cancel operations.
    ///
    /// # Panics
    /// Panics if the contract has already been initialised.
    pub fn initialize(e: Env, admin: Address) {
        if e.storage().instance().has(&DataKey::Admin) {
            panic!("already initialized");
        }
        e.storage().instance().set(&DataKey::Admin, &admin);
    }

    // -----------------------------------------------------------------------
    // Governance operations
    // -----------------------------------------------------------------------

    /// Queues a factory operation for execution after the 48-hour delay.
    ///
    /// # Arguments
    /// * `operation` - The factory operation to schedule.
    ///
    /// # Returns
    /// The 32-byte operation id that must be supplied to `execute_operation`
    /// or `cancel_operation`.
    ///
    /// # Authorization
    /// Requires the timelock admin to authorize.
    ///
    /// # Events
    /// Emits `op_queue` with `(operation_id, eta)`.
    pub fn queue_operation(e: Env, operation: FactoryOperation) -> BytesN<32> {
        let admin: Address = e.storage().instance().get(&DataKey::Admin).expect("not initialized");
        admin.require_auth();

        let now = e.ledger().timestamp();
        let eta = now + DELAY;

        let op_id = operation_id(&e, &operation, eta);

        if e.storage().persistent().has(&DataKey::Op(op_id.clone())) {
            panic!("operation already queued");
        }

        e.storage().persistent().set(&DataKey::Op(op_id.clone()), &eta);

        e.events().publish(
            (OP_QUEUED, admin),
            (op_id.clone(), eta),
        );

        op_id
    }

    /// Executes a previously queued operation once the delay has elapsed.
    ///
    /// # Arguments
    /// * `factory`   - The address of the Factory contract to call.
    /// * `operation` - The factory operation to execute (must match the queued one).
    /// * `eta`       - The eta that was returned when the operation was queued.
    ///
    /// # Authorization
    /// No special authorization required — anyone may trigger execution once
    /// the delay has passed.
    ///
    /// # Events
    /// Emits `op_exec` with `(operation_id, factory)`.
    pub fn execute_operation(e: Env, factory: Address, operation: FactoryOperation, eta: u64) {
        let op_id = operation_id(&e, &operation, eta);

        let stored_eta: u64 = e
            .storage()
            .persistent()
            .get(&DataKey::Op(op_id.clone()))
            .expect("operation not found");

        let now = e.ledger().timestamp();
        if now < stored_eta {
            panic!("timelock delay not elapsed");
        }

        // Remove before executing to prevent re-entrancy
        e.storage().persistent().remove(&DataKey::Op(op_id.clone()));

        // Dispatch the operation to the factory
        match operation {
            FactoryOperation::UpdateWasmHash(new_wasm_hash) => {
                let args = soroban_sdk::vec![&e, new_wasm_hash.into()];
                e.invoke_contract::<()>(
                    &factory,
                    &Symbol::new(&e, "update_wasm_hash"),
                    args,
                );
            }
        }

        e.events().publish(
            (OP_EXECUTED,),
            (op_id, factory),
        );
    }

    /// Cancels a queued operation before it is executed.
    ///
    /// # Arguments
    /// * `operation` - The factory operation to cancel.
    /// * `eta`       - The eta that was returned when the operation was queued.
    ///
    /// # Authorization
    /// Requires the timelock admin to authorize.
    ///
    /// # Events
    /// Emits `op_cancel` with `operation_id`.
    pub fn cancel_operation(e: Env, operation: FactoryOperation, eta: u64) {
        let admin: Address = e.storage().instance().get(&DataKey::Admin).expect("not initialized");
        admin.require_auth();

        let op_id = operation_id(&e, &operation, eta);

        if !e.storage().persistent().has(&DataKey::Op(op_id.clone())) {
            panic!("operation not found");
        }

        e.storage().persistent().remove(&DataKey::Op(op_id.clone()));

        e.events().publish(
            (OP_CANCELLED, admin),
            op_id,
        );
    }

    // -----------------------------------------------------------------------
    // Views
    // -----------------------------------------------------------------------

    /// Returns the scheduled eta for a queued operation, or `None` if it does
    /// not exist.
    ///
    /// # Arguments
    /// * `operation` - The factory operation to look up.
    /// * `eta`       - The eta that was returned when the operation was queued.
    pub fn get_operation_eta(e: Env, operation: FactoryOperation, eta: u64) -> Option<u64> {
        let op_id = operation_id(&e, &operation, eta);
        e.storage().persistent().get(&DataKey::Op(op_id))
    }

    /// Returns the current timelock admin address.
    pub fn get_admin(e: Env) -> Address {
        e.storage().instance().get(&DataKey::Admin).expect("not initialized")
    }

    /// Returns the minimum delay in seconds (48 hours).
    pub fn get_delay(_e: Env) -> u64 {
        DELAY
    }

    /// Returns the contract version string.
    pub fn version(e: Env) -> String {
        String::from_str(&e, "1.0.0")
    }

    /// Returns the operational status of the contract.
    pub fn status(e: Env) -> String {
        String::from_str(&e, "alive")
    }
}
