#![no_std]

use soroban_sdk::{
    contract, contractimpl, contracttype, symbol_short, Address, BytesN, Env, String, Symbol, Vec,
};

#[cfg(test)]
mod test_proof_of_burn;

/// Represents the reason for burning tokens
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum BurnReason {
    Deflationary,        // Reduce total supply
    CrossChainBridge,    // Bridge to another chain
    Redemption,          // Redeem for another asset
    Penalty,             // Penalty or slashing
    Upgrade,             // Token upgrade/migration
    Governance,          // Governance decision
    Other(String),       // Custom reason
}

/// Certificate status
#[contracttype]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum CertificateStatus {
    Active = 1,
    Verified = 2,
    Revoked = 3,
}

/// Proof-of-Burn certificate
#[contracttype]
#[derive(Clone, Debug)]
pub struct BurnCertificate {
    pub certificate_id: u64,
    pub burner: Address,
    pub token_address: Address,
    pub amount: i128,
    pub burn_reason: BurnReason,
    pub timestamp: u64,
    pub ledger_sequence: u32,
    pub transaction_hash: BytesN<32>,
    pub status: CertificateStatus,
    pub metadata: String, // Additional metadata (JSON string)
    pub verifier: Option<Address>, // Optional verifier who confirmed the burn
}

/// Aggregated burn statistics
#[contracttype]
#[derive(Clone, Debug)]
pub struct BurnStats {
    pub total_burns: u64,
    pub total_amount_burned: i128,
    pub unique_burners: u64,
    pub unique_tokens: u64,
}

/// Storage keys
#[contracttype]
#[derive(Clone)]
enum DataKey {
    Certificate(u64),           // Individual burn certificate
    NextCertificateId,          // Counter for certificate IDs
    BurnerCertificates(Address), // List of certificate IDs for a burner
    TokenCertificates(Address),  // List of certificate IDs for a token
    TotalBurned(Address),        // Total amount burned for a token
    Verifier(Address),           // Authorized verifiers
    Admin,                       // Contract administrator
    PublicDisplay,               // Whether certificates are publicly displayable
}

// Event symbols
const BURN_RECORDED: Symbol = symbol_short!("burn_rec");
const CERT_VERIFIED: Symbol = symbol_short!("cert_vrf");
const CERT_REVOKED: Symbol = symbol_short!("cert_rev");
const VERIFIER_ADDED: Symbol = symbol_short!("ver_add");
const VERIFIER_REMOVED: Symbol = symbol_short!("ver_rem");

/// Initialize the proof-of-burn contract
pub fn initialize(e: &Env, admin: Address) {
    admin.require_auth();
    
    // Set admin
    e.storage().instance().set(&DataKey::Admin, &admin);
    
    // Set initial certificate ID counter
    e.storage().instance().set(&DataKey::NextCertificateId, &0u64);
    
    // Enable public display by default
    e.storage().instance().set(&DataKey::PublicDisplay, &true);
    
    // Set admin as initial verifier
    e.storage()
        .persistent()
        .set(&DataKey::Verifier(admin.clone()), &true);
}

/// Get the admin address
pub fn get_admin(e: &Env) -> Address {
    e.storage()
        .instance()
        .get(&DataKey::Admin)
        .expect("Admin not set")
}

/// Check if an address is an authorized verifier
pub fn is_verifier(e: &Env, address: &Address) -> bool {
    e.storage()
        .persistent()
        .get(&DataKey::Verifier(address.clone()))
        .unwrap_or(false)
}

/// Add an authorized verifier
pub fn add_verifier(e: &Env, admin: Address, verifier: Address) {
    admin.require_auth();
    let stored_admin = get_admin(e);
    if admin != stored_admin {
        panic!("Unauthorized: not admin");
    }
    
    e.storage()
        .persistent()
        .set(&DataKey::Verifier(verifier.clone()), &true);
    
    e.events().publish((VERIFIER_ADDED, admin), verifier);
}

/// Remove an authorized verifier
pub fn remove_verifier(e: &Env, admin: Address, verifier: Address) {
    admin.require_auth();
    let stored_admin = get_admin(e);
    if admin != stored_admin {
        panic!("Unauthorized: not admin");
    }
    
    e.storage()
        .persistent()
        .remove(&DataKey::Verifier(verifier.clone()));
    
    e.events().publish((VERIFIER_REMOVED, admin), verifier);
}

/// Set public display setting
pub fn set_public_display(e: &Env, admin: Address, enabled: bool) {
    admin.require_auth();
    let stored_admin = get_admin(e);
    if admin != stored_admin {
        panic!("Unauthorized: not admin");
    }
    
    e.storage().instance().set(&DataKey::PublicDisplay, &enabled);
}

/// Check if public display is enabled
pub fn is_public_display_enabled(e: &Env) -> bool {
    e.storage()
        .instance()
        .get(&DataKey::PublicDisplay)
        .unwrap_or(true)
}

/// Record a burn event and create a certificate
/// 
/// # Arguments
/// * `burner` - The address that burned tokens
/// * `token_address` - The token contract address
/// * `amount` - Amount of tokens burned
/// * `burn_reason` - Reason for burning
/// * `transaction_hash` - Hash of the burn transaction
/// * `metadata` - Additional metadata (JSON string)
/// 
/// # Returns
/// The certificate ID
pub fn record_burn(
    e: &Env,
    burner: Address,
    token_address: Address,
    amount: i128,
    burn_reason: BurnReason,
    transaction_hash: BytesN<32>,
    metadata: String,
) -> u64 {
    burner.require_auth();
    
    // Validate amount
    if amount <= 0 {
        panic!("Invalid burn amount");
    }
    
    // Get next certificate ID
    let certificate_id: u64 = e
        .storage()
        .instance()
        .get(&DataKey::NextCertificateId)
        .unwrap_or(0);
    
    // Get current ledger info
    let timestamp = e.ledger().timestamp();
    let ledger_sequence = e.ledger().sequence();
    
    // Create burn certificate
    let certificate = BurnCertificate {
        certificate_id,
        burner: burner.clone(),
        token_address: token_address.clone(),
        amount,
        burn_reason: burn_reason.clone(),
        timestamp,
        ledger_sequence,
        transaction_hash: transaction_hash.clone(),
        status: CertificateStatus::Active,
        metadata: metadata.clone(),
        verifier: None,
    };
    
    // Store the certificate
    e.storage()
        .persistent()
        .set(&DataKey::Certificate(certificate_id), &certificate);
    
    // Update burner's certificate list
    let mut burner_certs: Vec<u64> = e
        .storage()
        .persistent()
        .get(&DataKey::BurnerCertificates(burner.clone()))
        .unwrap_or(Vec::new(e));
    burner_certs.push_back(certificate_id);
    e.storage()
        .persistent()
        .set(&DataKey::BurnerCertificates(burner.clone()), &burner_certs);
    
    // Update token's certificate list
    let mut token_certs: Vec<u64> = e
        .storage()
        .persistent()
        .get(&DataKey::TokenCertificates(token_address.clone()))
        .unwrap_or(Vec::new(e));
    token_certs.push_back(certificate_id);
    e.storage()
        .persistent()
        .set(&DataKey::TokenCertificates(token_address.clone()), &token_certs);
    
    // Update total burned for token
    let total_burned: i128 = e
        .storage()
        .persistent()
        .get(&DataKey::TotalBurned(token_address.clone()))
        .unwrap_or(0);
    e.storage()
        .persistent()
        .set(&DataKey::TotalBurned(token_address.clone()), &(total_burned + amount));
    
    // Increment certificate ID counter
    e.storage()
        .instance()
        .set(&DataKey::NextCertificateId, &(certificate_id + 1));
    
    // Emit event
    e.events().publish(
        (BURN_RECORDED, certificate_id),
        (burner, token_address, amount),
    );
    
    certificate_id
}

/// Verify a burn certificate
/// 
/// # Arguments
/// * `verifier` - The authorized verifier
/// * `certificate_id` - The certificate to verify
pub fn verify_certificate(e: &Env, verifier: Address, certificate_id: u64) {
    verifier.require_auth();
    
    if !is_verifier(e, &verifier) {
        panic!("Unauthorized: not a verifier");
    }
    
    // Get the certificate
    let mut certificate: BurnCertificate = e
        .storage()
        .persistent()
        .get(&DataKey::Certificate(certificate_id))
        .expect("Certificate not found");
    
    // Update status and verifier
    certificate.status = CertificateStatus::Verified;
    certificate.verifier = Some(verifier.clone());
    
    // Store updated certificate
    e.storage()
        .persistent()
        .set(&DataKey::Certificate(certificate_id), &certificate);
    
    // Emit event
    e.events()
        .publish((CERT_VERIFIED, certificate_id), verifier);
}

/// Revoke a burn certificate (admin only)
/// 
/// # Arguments
/// * `admin` - The admin address
/// * `certificate_id` - The certificate to revoke
pub fn revoke_certificate(e: &Env, admin: Address, certificate_id: u64) {
    admin.require_auth();
    let stored_admin = get_admin(e);
    if admin != stored_admin {
        panic!("Unauthorized: not admin");
    }
    
    // Get the certificate
    let mut certificate: BurnCertificate = e
        .storage()
        .persistent()
        .get(&DataKey::Certificate(certificate_id))
        .expect("Certificate not found");
    
    // Update status
    certificate.status = CertificateStatus::Revoked;
    
    // Store updated certificate
    e.storage()
        .persistent()
        .set(&DataKey::Certificate(certificate_id), &certificate);
    
    // Emit event
    e.events()
        .publish((CERT_REVOKED, certificate_id), admin);
}

/// Get a burn certificate by ID
pub fn get_certificate(e: &Env, certificate_id: u64) -> Option<BurnCertificate> {
    e.storage()
        .persistent()
        .get(&DataKey::Certificate(certificate_id))
}

/// Get the total number of certificates
pub fn get_certificate_count(e: &Env) -> u64 {
    e.storage()
        .instance()
        .get(&DataKey::NextCertificateId)
        .unwrap_or(0)
}

/// Get certificates for a specific burner
pub fn get_burner_certificates(e: &Env, burner: Address) -> Vec<u64> {
    e.storage()
        .persistent()
        .get(&DataKey::BurnerCertificates(burner))
        .unwrap_or(Vec::new(e))
}

/// Get certificates for a specific token
pub fn get_token_certificates(e: &Env, token_address: Address) -> Vec<u64> {
    e.storage()
        .persistent()
        .get(&DataKey::TokenCertificates(token_address))
        .unwrap_or(Vec::new(e))
}

/// Get total amount burned for a token
pub fn get_total_burned(e: &Env, token_address: Address) -> i128 {
    e.storage()
        .persistent()
        .get(&DataKey::TotalBurned(token_address))
        .unwrap_or(0)
}

/// Get multiple certificates in a range
pub fn get_certificates(e: &Env, start_id: u64, limit: u32) -> Vec<BurnCertificate> {
    let mut certificates = Vec::new(e);
    let max_id = get_certificate_count(e);
    let end_id = start_id.saturating_add(limit as u64).min(max_id);
    
    for id in start_id..end_id {
        if let Some(cert) = get_certificate(e, id) {
            certificates.push_back(cert);
        }
    }
    
    certificates
}

/// Get burn statistics
pub fn get_burn_stats(e: &Env) -> BurnStats {
    let total_burns = get_certificate_count(e);
    
    // Calculate total amount burned across all tokens
    // Note: This is a simplified implementation
    // In production, you might want to maintain a running total
    let mut total_amount_burned: i128 = 0;
    for id in 0..total_burns {
        if let Some(cert) = get_certificate(e, id) {
            if cert.status != CertificateStatus::Revoked {
                total_amount_burned += cert.amount;
            }
        }
    }
    
    BurnStats {
        total_burns,
        total_amount_burned,
        unique_burners: 0, // Would need additional tracking
        unique_tokens: 0,  // Would need additional tracking
    }
}

/// The deployable Proof-of-Burn Contract
#[contract]
pub struct ProofOfBurnContract;

#[contractimpl]
impl ProofOfBurnContract {
    /// Returns the contract version
    pub fn version(e: Env) -> String {
        String::from_str(&e, "1.0.0")
    }

    /// Returns the contract status
    pub fn status(e: Env) -> String {
        String::from_str(&e, "alive")
    }

    /// Initialize the contract
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

    /// Set public display setting
    pub fn set_public_display(e: Env, admin: Address, enabled: bool) {
        set_public_display(&e, admin, enabled);
    }

    /// Check if public display is enabled
    pub fn is_public_display_enabled(e: Env) -> bool {
        is_public_display_enabled(&e)
    }

    /// Record a burn event
    pub fn record_burn(
        e: Env,
        burner: Address,
        token_address: Address,
        amount: i128,
        burn_reason: BurnReason,
        transaction_hash: BytesN<32>,
        metadata: String,
    ) -> u64 {
        record_burn(
            &e,
            burner,
            token_address,
            amount,
            burn_reason,
            transaction_hash,
            metadata,
        )
    }

    /// Verify a certificate
    pub fn verify_certificate(e: Env, verifier: Address, certificate_id: u64) {
        verify_certificate(&e, verifier, certificate_id);
    }

    /// Revoke a certificate
    pub fn revoke_certificate(e: Env, admin: Address, certificate_id: u64) {
        revoke_certificate(&e, admin, certificate_id);
    }

    /// Get a certificate by ID
    pub fn get_certificate(e: Env, certificate_id: u64) -> Option<BurnCertificate> {
        get_certificate(&e, certificate_id)
    }

    /// Get certificate count
    pub fn get_certificate_count(e: Env) -> u64 {
        get_certificate_count(&e)
    }

    /// Get certificates for a burner
    pub fn get_burner_certificates(e: Env, burner: Address) -> Vec<u64> {
        get_burner_certificates(&e, burner)
    }

    /// Get certificates for a token
    pub fn get_token_certificates(e: Env, token_address: Address) -> Vec<u64> {
        get_token_certificates(&e, token_address)
    }

    /// Get total burned for a token
    pub fn get_total_burned(e: Env, token_address: Address) -> i128 {
        get_total_burned(&e, token_address)
    }

    /// Get multiple certificates
    pub fn get_certificates(e: Env, start_id: u64, limit: u32) -> Vec<BurnCertificate> {
        get_certificates(&e, start_id, limit)
    }

    /// Get burn statistics
    pub fn get_burn_stats(e: Env) -> BurnStats {
        get_burn_stats(&e)
    }
}
