#![no_std]

use soroban_sdk::{
    contract, contractimpl, contracttype, symbol_short, Address, Bytes, BytesN, Env, String,
    Symbol, Vec,
};

#[cfg(test)]
mod test_zk_audit_log;

/// Represents an action type that can be audited
#[contracttype]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum ActionType {
    Mint = 1,
    Burn = 2,
    Transfer = 3,
    AdminChange = 4,
    RoleGrant = 5,
    RoleRevoke = 6,
    ContractUpgrade = 7,
    ConfigChange = 8,
}

/// Audit log entry with ZK proof commitment
#[contracttype]
#[derive(Clone, Debug)]
pub struct AuditEntry {
    pub entry_id: u64,
    pub action_type: ActionType,
    pub timestamp: u64,
    pub proof_commitment: BytesN<32>, // Hash commitment of the ZK proof
    pub public_data_hash: BytesN<32>, // Hash of public data (non-sensitive)
    pub verifier: Address,             // Address that verified the proof
}

/// Storage keys for the audit log
#[contracttype]
#[derive(Clone)]
enum DataKey {
    Entry(u64),           // Individual audit entry
    NextEntryId,          // Counter for entry IDs
    Verifier(Address),    // Authorized verifiers
    ProofVerified(u64),   // Verification status of proof
}

// Event symbols
const AUDIT_LOGGED: Symbol = symbol_short!("audit_log");
const PROOF_VERIFIED: Symbol = symbol_short!("proof_vf");
const VERIFIER_ADDED: Symbol = symbol_short!("ver_add");
const VERIFIER_REMOVED: Symbol = symbol_short!("ver_rem");

/// Initialize the audit log contract with an admin
pub fn initialize(e: &Env, admin: Address) {
    admin.require_auth();
    
    // Set initial entry ID counter
    e.storage().instance().set(&DataKey::NextEntryId, &0u64);
    
    // Set admin as initial verifier
    e.storage()
        .persistent()
        .set(&DataKey::Verifier(admin.clone()), &true);
    
    e.events()
        .publish((VERIFIER_ADDED, "init"), admin);
}

/// Add an authorized verifier
pub fn add_verifier(e: &Env, admin: Address, verifier: Address) {
    admin.require_auth();
    require_verifier(e, &admin);
    
    e.storage()
        .persistent()
        .set(&DataKey::Verifier(verifier.clone()), &true);
    
    e.events()
        .publish((VERIFIER_ADDED, admin), verifier);
}

/// Remove an authorized verifier
pub fn remove_verifier(e: &Env, admin: Address, verifier: Address) {
    admin.require_auth();
    require_verifier(e, &admin);
    
    e.storage()
        .persistent()
        .remove(&DataKey::Verifier(verifier.clone()));
    
    e.events()
        .publish((VERIFIER_REMOVED, admin), verifier);
}

/// Check if an address is an authorized verifier
pub fn is_verifier(e: &Env, address: &Address) -> bool {
    e.storage()
        .persistent()
        .get(&DataKey::Verifier(address.clone()))
        .unwrap_or(false)
}

/// Require that an address is an authorized verifier
pub fn require_verifier(e: &Env, address: &Address) {
    if !is_verifier(e, address) {
        panic!("Unauthorized: not a verifier");
    }
}

/// Log a sensitive action with ZK proof commitment
/// 
/// # Arguments
/// * `verifier` - The address submitting the audit entry (must be authorized)
/// * `action_type` - The type of action being audited
/// * `proof_commitment` - Hash commitment of the ZK proof (e.g., Pedersen commitment)
/// * `public_data_hash` - Hash of any public metadata
/// 
/// # Returns
/// The entry ID of the logged audit entry
pub fn log_action(
    e: &Env,
    verifier: Address,
    action_type: ActionType,
    proof_commitment: BytesN<32>,
    public_data_hash: BytesN<32>,
) -> u64 {
    verifier.require_auth();
    require_verifier(e, &verifier);
    
    // Get next entry ID
    let entry_id: u64 = e
        .storage()
        .instance()
        .get(&DataKey::NextEntryId)
        .unwrap_or(0);
    
    // Get current ledger timestamp
    let timestamp = e.ledger().timestamp();
    
    // Create audit entry
    let entry = AuditEntry {
        entry_id,
        action_type,
        timestamp,
        proof_commitment: proof_commitment.clone(),
        public_data_hash: public_data_hash.clone(),
        verifier: verifier.clone(),
    };
    
    // Store the entry
    e.storage()
        .persistent()
        .set(&DataKey::Entry(entry_id), &entry);
    
    // Increment entry ID counter
    e.storage()
        .instance()
        .set(&DataKey::NextEntryId, &(entry_id + 1));
    
    // Emit event
    e.events().publish(
        (AUDIT_LOGGED, action_type as u32),
        (entry_id, proof_commitment, public_data_hash),
    );
    
    entry_id
}

/// Verify a ZK proof for an audit entry
/// 
/// # Arguments
/// * `verifier` - The address performing verification
/// * `entry_id` - The audit entry ID
/// * `proof_data` - The actual ZK proof data for verification
/// 
/// # Note
/// In a production system, this would integrate with a ZK proof verification library.
/// For this minimal implementation, we verify that the proof_data hashes to the commitment.
pub fn verify_proof(e: &Env, verifier: Address, entry_id: u64, proof_data: Bytes) -> bool {
    verifier.require_auth();
    require_verifier(e, &verifier);
    
    // Get the audit entry
    let entry: AuditEntry = e
        .storage()
        .persistent()
        .get(&DataKey::Entry(entry_id))
        .expect("Audit entry not found");
    
    // Verify that the proof_data hashes to the stored commitment
    let proof_hash = e.crypto().sha256(&proof_data);
    let is_valid = proof_hash == entry.proof_commitment;
    
    // Store verification result
    e.storage()
        .persistent()
        .set(&DataKey::ProofVerified(entry_id), &is_valid);
    
    // Emit verification event
    e.events()
        .publish((PROOF_VERIFIED, entry_id), (verifier, is_valid));
    
    is_valid
}

/// Get an audit entry by ID
pub fn get_entry(e: &Env, entry_id: u64) -> Option<AuditEntry> {
    e.storage().persistent().get(&DataKey::Entry(entry_id))
}

/// Get the total number of audit entries
pub fn get_entry_count(e: &Env) -> u64 {
    e.storage()
        .instance()
        .get(&DataKey::NextEntryId)
        .unwrap_or(0)
}

/// Get multiple audit entries in a range
pub fn get_entries(e: &Env, start_id: u64, limit: u32) -> Vec<AuditEntry> {
    let mut entries = Vec::new(e);
    let max_id = get_entry_count(e);
    let end_id = start_id.saturating_add(limit as u64).min(max_id);
    
    for id in start_id..end_id {
        if let Some(entry) = get_entry(e, id) {
            entries.push_back(entry);
        }
    }
    
    entries
}

/// Check if a proof has been verified
pub fn is_proof_verified(e: &Env, entry_id: u64) -> bool {
    e.storage()
        .persistent()
        .get(&DataKey::ProofVerified(entry_id))
        .unwrap_or(false)
}

/// The deployable ZK Audit Log Contract
#[contract]
pub struct ZkAuditLogContract;

#[contractimpl]
impl ZkAuditLogContract {
    /// Returns the contract version
    pub fn version(e: Env) -> String {
        String::from_str(&e, "1.0.0")
    }

    /// Returns the contract status
    pub fn status(e: Env) -> String {
        String::from_str(&e, "alive")
    }

    /// Initialize the audit log with an admin/verifier
    pub fn initialize(e: Env, admin: Address) {
        initialize(&e, admin);
    }

    /// Add an authorized verifier
    pub fn add_verifier(e: Env, admin: Address, verifier: Address) {
        add_verifier(&e, admin, verifier);
    }

    /// Remove an authorized verifier
    pub fn remove_verifier(e: Env, admin: Address, verifier: Address) {
        remove_verifier(&e, admin, verifier);
    }

    /// Check if an address is a verifier
    pub fn is_verifier(e: Env, address: Address) -> bool {
        is_verifier(&e, &address)
    }

    /// Log a sensitive action with ZK proof commitment
    pub fn log_action(
        e: Env,
        verifier: Address,
        action_type: ActionType,
        proof_commitment: BytesN<32>,
        public_data_hash: BytesN<32>,
    ) -> u64 {
        log_action(&e, verifier, action_type, proof_commitment, public_data_hash)
    }

    /// Verify a ZK proof for an audit entry
    pub fn verify_proof(e: Env, verifier: Address, entry_id: u64, proof_data: Bytes) -> bool {
        verify_proof(&e, verifier, entry_id, proof_data)
    }

    /// Get an audit entry by ID
    pub fn get_entry(e: Env, entry_id: u64) -> Option<AuditEntry> {
        get_entry(&e, entry_id)
    }

    /// Get the total number of audit entries
    pub fn get_entry_count(e: Env) -> u64 {
        get_entry_count(&e)
    }

    /// Get multiple audit entries
    pub fn get_entries(e: Env, start_id: u64, limit: u32) -> Vec<AuditEntry> {
        get_entries(&e, start_id, limit)
    }

    /// Check if a proof has been verified
    pub fn is_proof_verified(e: Env, entry_id: u64) -> bool {
        is_proof_verified(&e, entry_id)
    }
}
