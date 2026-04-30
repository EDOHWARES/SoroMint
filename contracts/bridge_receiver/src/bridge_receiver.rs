#![no_std]

use soroban_sdk::{
    contract, contractimpl, contracttype, symbol_short, Address, Bytes, BytesN, Env, String,
    Symbol, Vec,
};

#[cfg(test)]
mod test_bridge_receiver;

/// Represents the source chain for cross-chain operations
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum SourceChain {
    Ethereum,
    BinanceSmartChain,
    Polygon,
    Avalanche,
    Arbitrum,
    Optimism,
    Base,
    Other(String),
}

/// Status of a bridge transaction
#[contracttype]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum BridgeStatus {
    Pending = 1,
    Verified = 2,
    Executed = 3,
    Failed = 4,
    Cancelled = 5,
}

/// Bridge mint signal from cross-chain relayer
#[contracttype]
#[derive(Clone, Debug)]
pub struct MintSignal {
    pub signal_id: u64,
    pub source_chain: SourceChain,
    pub source_tx_hash: BytesN<32>,
    pub recipient: Address,
    pub token_address: Address,
    pub amount: i128,
    pub nonce: u64,
    pub timestamp: u64,
    pub status: BridgeStatus,
    pub relayer: Address,
    pub verification_proof: Bytes, // Proof data from bridge verification
}

/// Storage keys
#[contracttype]
#[derive(Clone)]
enum DataKey {
    Signal(u64),              // Individual mint signal
    NextSignalId,             // Counter for signal IDs
    Relayer(Address),         // Authorized relayers
    ProcessedTx(BytesN<32>),  // Track processed source transactions
    TokenContract,            // Address of the token contract to mint
    Admin,                    // Contract administrator
    Paused,                   // Emergency pause flag
}

// Event symbols
const SIGNAL_RECEIVED: Symbol = symbol_short!("sig_recv");
const SIGNAL_VERIFIED: Symbol = symbol_short!("sig_vrfy");
const SIGNAL_EXECUTED: Symbol = symbol_short!("sig_exec");
const SIGNAL_FAILED: Symbol = symbol_short!("sig_fail");
const RELAYER_ADDED: Symbol = symbol_short!("rel_add");
const RELAYER_REMOVED: Symbol = symbol_short!("rel_rem");
const PAUSED: Symbol = symbol_short!("paused");
const UNPAUSED: Symbol = symbol_short!("unpaused");

/// Initialize the bridge receiver contract
pub fn initialize(e: &Env, admin: Address, token_contract: Address) {
    admin.require_auth();
    
    // Set admin
    e.storage().instance().set(&DataKey::Admin, &admin);
    
    // Set token contract
    e.storage()
        .instance()
        .set(&DataKey::TokenContract, &token_contract);
    
    // Set initial signal ID counter
    e.storage().instance().set(&DataKey::NextSignalId, &0u64);
    
    // Set admin as initial relayer
    e.storage()
        .persistent()
        .set(&DataKey::Relayer(admin.clone()), &true);
    
    // Not paused by default
    e.storage().instance().set(&DataKey::Paused, &false);
}

/// Get the admin address
pub fn get_admin(e: &Env) -> Address {
    e.storage()
        .instance()
        .get(&DataKey::Admin)
        .expect("Admin not set")
}

/// Check if contract is paused
pub fn is_paused(e: &Env) -> bool {
    e.storage()
        .instance()
        .get(&DataKey::Paused)
        .unwrap_or(false)
}

/// Pause the contract (emergency stop)
pub fn pause(e: &Env, admin: Address) {
    admin.require_auth();
    let stored_admin = get_admin(e);
    if admin != stored_admin {
        panic!("Unauthorized: not admin");
    }
    
    e.storage().instance().set(&DataKey::Paused, &true);
    e.events().publish((PAUSED,), admin);
}

/// Unpause the contract
pub fn unpause(e: &Env, admin: Address) {
    admin.require_auth();
    let stored_admin = get_admin(e);
    if admin != stored_admin {
        panic!("Unauthorized: not admin");
    }
    
    e.storage().instance().set(&DataKey::Paused, &false);
    e.events().publish((UNPAUSED,), admin);
}

/// Add an authorized relayer
pub fn add_relayer(e: &Env, admin: Address, relayer: Address) {
    admin.require_auth();
    let stored_admin = get_admin(e);
    if admin != stored_admin {
        panic!("Unauthorized: not admin");
    }
    
    e.storage()
        .persistent()
        .set(&DataKey::Relayer(relayer.clone()), &true);
    
    e.events().publish((RELAYER_ADDED, admin), relayer);
}

/// Remove an authorized relayer
pub fn remove_relayer(e: &Env, admin: Address, relayer: Address) {
    admin.require_auth();
    let stored_admin = get_admin(e);
    if admin != stored_admin {
        panic!("Unauthorized: not admin");
    }
    
    e.storage()
        .persistent()
        .remove(&DataKey::Relayer(relayer.clone()));
    
    e.events().publish((RELAYER_REMOVED, admin), relayer);
}

/// Check if an address is an authorized relayer
pub fn is_relayer(e: &Env, address: &Address) -> bool {
    e.storage()
        .persistent()
        .get(&DataKey::Relayer(address.clone()))
        .unwrap_or(false)
}

/// Require that an address is an authorized relayer
pub fn require_relayer(e: &Env, address: &Address) {
    if !is_relayer(e, address) {
        panic!("Unauthorized: not a relayer");
    }
}

/// Require that the contract is not paused
pub fn require_not_paused(e: &Env) {
    if is_paused(e) {
        panic!("Contract is paused");
    }
}

/// Check if a source transaction has been processed
pub fn is_tx_processed(e: &Env, source_tx_hash: &BytesN<32>) -> bool {
    e.storage()
        .persistent()
        .get(&DataKey::ProcessedTx(source_tx_hash.clone()))
        .unwrap_or(false)
}

/// Mark a source transaction as processed
fn mark_tx_processed(e: &Env, source_tx_hash: &BytesN<32>) {
    e.storage()
        .persistent()
        .set(&DataKey::ProcessedTx(source_tx_hash.clone()), &true);
}

/// Receive a mint signal from a bridge relayer
/// 
/// # Arguments
/// * `relayer` - The authorized relayer submitting the signal
/// * `source_chain` - The chain where the original transaction occurred
/// * `source_tx_hash` - Transaction hash on the source chain
/// * `recipient` - Address to receive minted tokens on Soroban
/// * `amount` - Amount of tokens to mint
/// * `nonce` - Unique nonce for replay protection
/// * `verification_proof` - Proof data from bridge verification (e.g., Merkle proof)
/// 
/// # Returns
/// The signal ID
pub fn receive_mint_signal(
    e: &Env,
    relayer: Address,
    source_chain: SourceChain,
    source_tx_hash: BytesN<32>,
    recipient: Address,
    amount: i128,
    nonce: u64,
    verification_proof: Bytes,
) -> u64 {
    relayer.require_auth();
    require_not_paused(e);
    require_relayer(e, &relayer);
    
    // Check if transaction already processed (replay protection)
    if is_tx_processed(e, &source_tx_hash) {
        panic!("Transaction already processed");
    }
    
    // Validate amount
    if amount <= 0 {
        panic!("Invalid amount");
    }
    
    // Get next signal ID
    let signal_id: u64 = e
        .storage()
        .instance()
        .get(&DataKey::NextSignalId)
        .unwrap_or(0);
    
    // Get token contract address
    let token_contract: Address = e
        .storage()
        .instance()
        .get(&DataKey::TokenContract)
        .expect("Token contract not set");
    
    // Get current timestamp
    let timestamp = e.ledger().timestamp();
    
    // Create mint signal
    let signal = MintSignal {
        signal_id,
        source_chain: source_chain.clone(),
        source_tx_hash: source_tx_hash.clone(),
        recipient: recipient.clone(),
        token_address: token_contract,
        amount,
        nonce,
        timestamp,
        status: BridgeStatus::Pending,
        relayer: relayer.clone(),
        verification_proof: verification_proof.clone(),
    };
    
    // Store the signal
    e.storage()
        .persistent()
        .set(&DataKey::Signal(signal_id), &signal);
    
    // Increment signal ID counter
    e.storage()
        .instance()
        .set(&DataKey::NextSignalId, &(signal_id + 1));
    
    // Emit event
    e.events().publish(
        (SIGNAL_RECEIVED, signal_id),
        (source_tx_hash, recipient, amount),
    );
    
    signal_id
}

/// Verify and execute a mint signal
/// 
/// # Arguments
/// * `relayer` - The relayer executing the signal
/// * `signal_id` - The signal to execute
/// 
/// # Note
/// In production, this would call the token contract's mint function
pub fn execute_mint_signal(e: &Env, relayer: Address, signal_id: u64) -> bool {
    relayer.require_auth();
    require_not_paused(e);
    require_relayer(e, &relayer);
    
    // Get the signal
    let mut signal: MintSignal = e
        .storage()
        .persistent()
        .get(&DataKey::Signal(signal_id))
        .expect("Signal not found");
    
    // Check status
    if signal.status != BridgeStatus::Pending {
        panic!("Signal already processed");
    }
    
    // Verify the proof (simplified - in production, verify Merkle proof or ZK proof)
    let is_valid = verify_bridge_proof(e, &signal);
    
    if !is_valid {
        signal.status = BridgeStatus::Failed;
        e.storage()
            .persistent()
            .set(&DataKey::Signal(signal_id), &signal);
        
        e.events()
            .publish((SIGNAL_FAILED, signal_id), relayer);
        
        return false;
    }
    
    // Mark as verified
    signal.status = BridgeStatus::Verified;
    e.storage()
        .persistent()
        .set(&DataKey::Signal(signal_id), &signal);
    
    e.events()
        .publish((SIGNAL_VERIFIED, signal_id), relayer.clone());
    
    // Mark source transaction as processed
    mark_tx_processed(e, &signal.source_tx_hash);
    
    // Execute the mint (in production, call token contract)
    // token_contract.mint(signal.recipient, signal.amount);
    
    // Update status to executed
    signal.status = BridgeStatus::Executed;
    e.storage()
        .persistent()
        .set(&DataKey::Signal(signal_id), &signal);
    
    e.events().publish(
        (SIGNAL_EXECUTED, signal_id),
        (signal.recipient, signal.amount),
    );
    
    true
}

/// Verify bridge proof (simplified implementation)
/// In production, this would verify:
/// - Merkle proofs for transaction inclusion
/// - Multi-signature verification
/// - ZK proofs for privacy-preserving bridges
fn verify_bridge_proof(e: &Env, signal: &MintSignal) -> bool {
    // Simplified verification: check that proof is not empty
    // In production, implement actual cryptographic verification
    !signal.verification_proof.is_empty()
}

/// Get a mint signal by ID
pub fn get_signal(e: &Env, signal_id: u64) -> Option<MintSignal> {
    e.storage().persistent().get(&DataKey::Signal(signal_id))
}

/// Get the total number of signals
pub fn get_signal_count(e: &Env) -> u64 {
    e.storage()
        .instance()
        .get(&DataKey::NextSignalId)
        .unwrap_or(0)
}

/// Get multiple signals in a range
pub fn get_signals(e: &Env, start_id: u64, limit: u32) -> Vec<MintSignal> {
    let mut signals = Vec::new(e);
    let max_id = get_signal_count(e);
    let end_id = start_id.saturating_add(limit as u64).min(max_id);
    
    for id in start_id..end_id {
        if let Some(signal) = get_signal(e, id) {
            signals.push_back(signal);
        }
    }
    
    signals
}

/// The deployable Bridge Receiver Contract
#[contract]
pub struct BridgeReceiverContract;

#[contractimpl]
impl BridgeReceiverContract {
    /// Returns the contract version
    pub fn version(e: Env) -> String {
        String::from_str(&e, "1.0.0")
    }

    /// Returns the contract status
    pub fn status(e: Env) -> String {
        String::from_str(&e, "alive")
    }

    /// Initialize the bridge receiver
    pub fn initialize(e: Env, admin: Address, token_contract: Address) {
        initialize(&e, admin, token_contract);
    }

    /// Pause the contract
    pub fn pause(e: Env, admin: Address) {
        pause(&e, admin);
    }

    /// Unpause the contract
    pub fn unpause(e: Env, admin: Address) {
        unpause(&e, admin);
    }

    /// Check if paused
    pub fn is_paused(e: Env) -> bool {
        is_paused(&e)
    }

    /// Add an authorized relayer
    pub fn add_relayer(e: Env, admin: Address, relayer: Address) {
        add_relayer(&e, admin, relayer);
    }

    /// Remove an authorized relayer
    pub fn remove_relayer(e: Env, admin: Address, relayer: Address) {
        remove_relayer(&e, admin, relayer);
    }

    /// Check if an address is a relayer
    pub fn is_relayer(e: Env, address: Address) -> bool {
        is_relayer(&e, &address)
    }

    /// Receive a mint signal from bridge
    pub fn receive_mint_signal(
        e: Env,
        relayer: Address,
        source_chain: SourceChain,
        source_tx_hash: BytesN<32>,
        recipient: Address,
        amount: i128,
        nonce: u64,
        verification_proof: Bytes,
    ) -> u64 {
        receive_mint_signal(
            &e,
            relayer,
            source_chain,
            source_tx_hash,
            recipient,
            amount,
            nonce,
            verification_proof,
        )
    }

    /// Execute a mint signal
    pub fn execute_mint_signal(e: Env, relayer: Address, signal_id: u64) -> bool {
        execute_mint_signal(&e, relayer, signal_id)
    }

    /// Get a signal by ID
    pub fn get_signal(e: Env, signal_id: u64) -> Option<MintSignal> {
        get_signal(&e, signal_id)
    }

    /// Get signal count
    pub fn get_signal_count(e: Env) -> u64 {
        get_signal_count(&e)
    }

    /// Get multiple signals
    pub fn get_signals(e: Env, start_id: u64, limit: u32) -> Vec<MintSignal> {
        get_signals(&e, start_id, limit)
    }

    /// Check if transaction is processed
    pub fn is_tx_processed(e: Env, source_tx_hash: BytesN<32>) -> bool {
        is_tx_processed(&e, &source_tx_hash)
    }
}
