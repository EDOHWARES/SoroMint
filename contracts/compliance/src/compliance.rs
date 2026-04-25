#![no_std]

use soroban_sdk::{
    contract, contractimpl, contracttype, symbol_short, Address, Env, String, Symbol, Vec, IntoVal,
};

#[cfg(test)]
mod test_compliance;

mod events;

use events::{emit_clawback_executed, emit_config_updated, emit_token_set, emit_clawback_admin_set, emit_blacklist_updated};

#[contracttype]
#[derive(Clone)]
enum DataKey {
    Admin,
    Blacklisted(Address),
    ClawbackAdmin,
    TokenAddress,
    ClawbackCounter,
    ClawbackRecord(u64),
    DefaultJurisdiction,
}

/// Reason codes for regulatory clawback actions.
/// Each code maps to a typical regulatory scenario.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum ClawbackReason {
    /// Fraud or misrepresentation
    Fraud = 1,
    /// Sanctions or embargo violation
    Sanctions = 2,
    /// Court order or legal judgment
    CourtOrder = 3,
    /// Regulatory enforcement action
    Regulatory = 4,
    /// Anti-money laundering (AML) seizure
    AmlSeizure = 5,
    /// Terrorism financing prevention
    TerrorismFinancing = 6,
    /// Tax evasion or non-compliance
    TaxEvasion = 7,
    /// Other legal requirement
    Other = 8,
}

/// Jurisdiction codes for compliance operations.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum Jurisdiction {
    /// United States
    US = 1,
    /// European Union
    EU = 2,
    /// United Kingdom
    UK = 3,
    /// Canada
    CA = 4,
    /// Singapore
    SG = 5,
    /// Switzerland
    CH = 6,
    /// Japan
    JP = 7,
    /// Offshore/International
    OFFSHORE = 8,
    /// Global/Multi-jurisdiction
    GLOBAL = 9,
    /// Other
    OTHER = 10,
}

/// Detailed audit record of a clawback action.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ClawbackRecord {
    /// Unique record identifier
    pub id: u64,
    /// Address from which tokens were seized
    pub from: Address,
    /// Amount of tokens burned
    pub amount: i128,
    /// Reason code for the clawback
    pub reason: ClawbackReason,
    /// Jurisdiction under which the clawback was authorized
    pub jurisdiction: Jurisdiction,
    /// Optional reference to legal authority (case number, order ID, etc.)
    pub legal_reference: Option<String>,
    /// Optional free-text notes for compliance officers
    pub notes: Option<String>,
    /// Unix timestamp (seconds) when the clawback was executed
    pub timestamp: u64,
    /// Address of the clawback admin who executed
    pub executed_by: Address,
}

/// Initializes the compliance contract with admin, clawback admin, token address, and optional jurisdiction.
///
/// # Arguments
/// * `admin` - The address to set as compliance admin.
/// * `clawback_admin` - The address authorized to execute clawbacks.
/// * `token_address` - The address of the SMT token contract.
/// * `default_jurisdiction` - The default jurisdiction for clawbacks.
///
/// # Panics
/// Panics if already initialized.
pub fn initialize(e: &Env, admin: Address, clawback_admin: Address, token_address: Address, default_jurisdiction: Jurisdiction) {
    if e.storage().instance().has(&DataKey::TokenAddress) {
        panic!("already initialized");
    }

    e.storage().instance().set(&DataKey::Admin, &admin);
    e.storage().instance().set(&DataKey::ClawbackAdmin, &clawback_admin);
    e.storage().instance().set(&DataKey::TokenAddress, &token_address);
    e.storage().instance().set(&DataKey::ClawbackCounter, &0u64);
    e.storage().instance().set(&DataKey::DefaultJurisdiction, &default_jurisdiction);
}

/// Returns the current clawback admin address.
pub fn get_clawback_admin(e: &Env) -> Address {
    e.storage().instance().get(&DataKey::ClawbackAdmin).expect("Clawback admin not set")
}

/// Sets the clawback admin address.
///
/// # Authorization
/// Requires `admin` to authorize and be the stored admin.
pub fn set_clawback_admin(e: Env, admin: Address, new_clawback_admin: Address) {
    admin.require_auth();
    require_admin(&e, &admin);
    e.storage().instance().set(&DataKey::ClawbackAdmin, &new_clawback_admin);
    emit_clawback_admin_set(&e, &admin, &new_clawback_admin);
}

/// Sets the SMT token contract address that will be called for clawback execution.
///
/// # Authorization
/// Requires `admin` to authorize and be the stored admin.
pub fn set_token_address(e: Env, admin: Address, token_address: Address) {
    admin.require_auth();
    require_admin(&e, &admin);
    e.storage().instance().set(&DataKey::TokenAddress, &token_address);
    emit_token_set(&e, &admin, &token_address);
}

/// Returns the current default jurisdiction.
pub fn get_default_jurisdiction(e: &Env) -> Jurisdiction {
    e.storage().instance().get(&DataKey::DefaultJurisdiction).unwrap_or(Jurisdiction::GLOBAL)
}

/// Sets the default jurisdiction for clawback operations.
///
/// # Authorization
/// Requires `admin` to authorize.
pub fn set_default_jurisdiction(e: Env, admin: Address, jurisdiction: Jurisdiction) {
    admin.require_auth();
    require_admin(&e, &admin);
    let old_jur = e.storage().instance().get(&DataKey::DefaultJurisdiction).unwrap_or(Jurisdiction::GLOBAL);
    let old_str = jurisdiction_to_string(&e, &old_jur);
    let new_str = jurisdiction_to_string(&e, &jurisdiction);
    e.storage().instance().set(&DataKey::DefaultJurisdiction, &jurisdiction);
    emit_config_updated(&e, &admin, "default_jurisdiction", old_str, new_str);
}

/// Executes a clawback (token burn) on the specified address for regulatory compliance.
///
/// This function:
/// 1. Verifies caller is the designated ClawbackAdmin
/// 2. Validates that the source address has sufficient balance
/// 3. Invokes the token contract's clawback function to burn tokens
/// 4. Stores a detailed audit record
/// 5. Emits a ClawbackExecuted event with full compliance metadata
///
/// # Arguments
/// * `caller` - The address invoking (must be ClawbackAdmin, auth required)
/// * `from` - The address from which tokens will be seized/burned
/// * `amount` - Amount of tokens to clawback (must be positive)
/// * `reason` - Regulatory reason code for the clawback
/// * `jurisdiction` - Jurisdiction code (uses default if not specified)
/// * `legal_reference` - Optional reference to legal authority (case #, order ID)
/// * `notes` - Optional free-text compliance notes
///
/// # Authorization
/// Requires `caller` to be the registered ClawbackAdmin and authorize the transaction.
///
/// # Panics
/// Panics if insufficient balance, zero/negative amount, or unauthorized caller.
pub fn clawback(
    e: Env,
    caller: Address,
    from: Address,
    amount: i128,
    reason: ClawbackReason,
    jurisdiction: Option<Jurisdiction>,
    legal_reference: Option<String>,
    notes: Option<String>,
) {
    caller.require_auth();
    let stored_clawback_admin: Address = e.storage().instance().get(&DataKey::ClawbackAdmin).expect("Clawback admin not configured");
    if caller != stored_clawback_admin {
        panic!("Unauthorized: not clawback admin");
    }

    if amount <= 0 {
        panic!("amount must be positive");
    }

    let token_address: Address = e.storage().instance().get(&DataKey::TokenAddress).expect("Token address not set");

    // Call token contract's clawback function
    use soroban_sdk::{IntoVal, Symbol};
    let args = soroban_sdk::vec![
        &e,
        from.into_val(&e),
        amount.into_val(&e),
    ];
    e.invoke_contract::<()>(&token_address, &Symbol::new(&e, "clawback"), args);

    // Record timestamp
    let timestamp = e.ledger().timestamp();

    // Store audit record
    let counter: u64 = e.storage().instance().get(&DataKey::ClawbackCounter).unwrap_or(0);
    let record_id = counter + 1;

    let record = ClawbackRecord {
        id: record_id,
        from: from.clone(),
        amount,
        reason: reason.clone(),
        jurisdiction: jurisdiction.unwrap_or_else(|| get_default_jurisdiction(&e)),
        legal_reference: legal_reference.clone(),
        notes: notes.clone(),
        timestamp,
        executed_by: caller.clone(),
    };

    e.storage().instance().set(&DataKey::ClawbackRecord(record_id), &record);
    e.storage().instance().set(&DataKey::ClawbackCounter, &record_id);

    // Emit detailed event
    let reason_str = reason_to_string(&e, reason);
    let jurisdiction_str = jurisdiction_to_string(&e, &record.jurisdiction);
    emit_clawback_executed(
        &e,
        &caller,
        &from,
        amount,
        &reason_str,
        &jurisdiction_str,
        &legal_reference,
        &notes,
        timestamp,
    );
}

/// Returns the ClawbackRecord for a given record ID, if it exists.
pub fn get_clawback_record(e: &Env, record_id: u64) -> Option<ClawbackRecord> {
    e.storage().instance().get(&DataKey::ClawbackRecord(record_id))
}

/// Returns the most recent N clawback records, newest first.
pub fn get_recent_clawbacks(e: &Env, limit: u32) -> Vec<ClawbackRecord> {
    let counter: u64 = e.storage().instance().get(&DataKey::ClawbackCounter).unwrap_or(0);
    let mut results = Vec::new(&e);
    let limit_usize = limit as usize;
    let mut count = 0;

    for id in (1..=counter).rev() {
        if count >= limit_usize {
            break;
        }
        if let Some(record) = e.storage().instance().get::<_, ClawbackRecord>(&DataKey::ClawbackRecord(id)) {
            results.push_back(record);
            count += 1;
        }
    }
    results
}

/// Returns all clawback records for a specific address.
pub fn get_clawbacks_for_address(e: &Env, addr: Address, limit: u32, offset: u32) -> Vec<ClawbackRecord> {
    let counter: u64 = e.storage().instance().get(&DataKey::ClawbackCounter).unwrap_or(0);
    let mut results = Vec::new(&e);
    let mut matched: u32 = 0;

    for id in (1..=counter).rev() {
        if let Some(record) = e.storage().instance().get::<_, ClawbackRecord>(&DataKey::ClawbackRecord(id)) {
            if record.from == addr {
                if matched >= offset && (results.len() as u32) < limit {
                    results.push_back(record);
                }
                matched += 1;
            }
        }
    }
    results
}

/// Returns the total number of clawback records stored.
pub fn get_clawback_count(e: &Env) -> u64 {
    e.storage().instance().get(&DataKey::ClawbackCounter).unwrap_or(0)
}

// --- Blacklist functions (unchanged) ---

/// Sets the blacklist status for a specific address.
///
/// # Arguments
/// * `admin` - The address of the administrator (checked for auth).
/// * `addr`  - The address to update status for.
/// * `banned` - Boolean flag: true to blacklist, false to un-blacklist.
///
/// # Authorization
/// Requires `admin` to authorize the transaction and be the stored admin.
pub fn set_blacklist(e: Env, admin: Address, addr: Address, banned: bool) {
    admin.require_auth();
    require_admin(&e, &admin);

    if banned {
        e.storage()
            .persistent()
            .set(&DataKey::Blacklisted(addr.clone()), &true);
    } else {
        e.storage()
            .persistent()
            .remove(&DataKey::Blacklisted(addr.clone()));
    }

    emit_blacklist_updated(&e, &admin, &addr, banned);
}

/// Returns whether an address is blacklisted.
pub fn is_blacklisted(e: &Env, addr: Address) -> bool {
    e.storage()
        .persistent()
        .get(&DataKey::Blacklisted(addr))
        .unwrap_or(false)
}

/// Asserts that the given address is NOT blacklisted.
///
/// # Panics
/// Panics with "Address is blacklisted" if the address is on the blacklist.
pub fn require_not_blacklisted(e: &Env, addr: Address) {
    if is_blacklisted(e, addr) {
        panic!("Address is blacklisted");
    }
}

/// Returns the current admin address.
pub fn get_admin(e: &Env) -> Address {
    e.storage().instance().get(&DataKey::Admin).expect("Admin not initialized")
}

/// Sets the admin address. Only callable by current admin.
pub fn set_admin(e: Env, current_admin: Address, new_admin: Address) {
    current_admin.require_auth();
    let stored_admin: Address = e.storage().instance().get(&DataKey::Admin).expect("Admin not set");
    if current_admin != stored_admin {
        panic!("Unauthorized: not admin");
    }
    e.storage().instance().set(&DataKey::Admin, &new_admin);
}

/// Asserts the caller is the admin.
pub fn require_admin(e: &Env, caller: &Address) {
    let admin: Address = e.storage().instance().get(&DataKey::Admin).expect("Admin not set");
    if *caller != admin {
        panic!("Unauthorized: not admin");
    }
}

/// The deployable ComplianceContract exposing blacklist management, clawback, and versioning.
#[contract]
pub struct ComplianceContract;

#[contractimpl]
impl ComplianceContract {
    /// Returns the contract version string in semver format.
    /// @return "1.0.0"
    pub fn version(e: Env) -> String {
        String::from_str(&e, "1.0.0")
    }

    /// Returns the operational status of the contract.
    /// @return "alive"
    pub fn status(e: Env) -> String {
        String::from_str(&e, "alive")
    }

    // --- Initialization & configuration ---

    /// Initializes the compliance contract.
    /// @param admin Initial admin address.
    /// @param clawback_admin Address authorized to execute clawbacks.
    /// @param token_address Address of the SMT token contract.
    /// @param default_jurisdiction Default jurisdiction for clawbacks.
    pub fn initialize(e: Env, admin: Address, clawback_admin: Address, token_address: Address, default_jurisdiction: Jurisdiction) {
        initialize(&e, admin, clawback_admin, token_address, default_jurisdiction);
    }

    /// Sets the clawback admin. @auth Requires admin auth.
    pub fn set_clawback_admin(e: Env, admin: Address, new_clawback_admin: Address) {
        set_clawback_admin(e, admin, new_clawback_admin);
    }

    /// Sets the SMT token contract address. @auth Requires admin auth.
    pub fn set_token_address(e: Env, admin: Address, token_address: Address) {
        set_token_address(e, admin, token_address);
    }

    /// Sets the default clawback jurisdiction. @auth Requires admin auth.
    pub fn set_default_jurisdiction(e: Env, admin: Address, jurisdiction: Jurisdiction) {
        set_default_jurisdiction(e, admin, jurisdiction);
    }

    /// Returns the current clawback admin address.
    pub fn get_clawback_admin(e: Env) -> Address {
        get_clawback_admin(&e)
    }

    /// Returns the configured token contract address.
    pub fn get_token_address(e: Env) -> Address {
        e.storage().instance().get(&DataKey::TokenAddress).expect("Token address not set")
    }

    /// Returns the default jurisdiction for clawback operations.
    pub fn get_default_jurisdiction(e: Env) -> Jurisdiction {
        get_default_jurisdiction(&e)
    }

    /// Returns the current admin address.
    pub fn get_admin(e: Env) -> Address {
        get_admin(&e)
    }

    /// Sets the admin address. @auth Requires current admin to authorize.
    pub fn set_admin(e: Env, current_admin: Address, new_admin: Address) {
        set_admin(e, current_admin, new_admin);
    }

    // --- Blacklist management ---

    /// Sets the blacklist status for a specific address. @auth Requires admin auth.
    pub fn set_blacklist(e: Env, admin: Address, addr: Address, banned: bool) {
        set_blacklist(e, admin, addr, banned);
    }

    /// Returns whether an address is blacklisted.
    pub fn is_blacklisted(e: Env, addr: Address) -> bool {
        is_blacklisted(&e, addr)
    }

    /// Panics if the address is blacklisted.
    pub fn require_not_blacklisted(e: Env, addr: Address) {
        require_not_blacklisted(&e, addr);
    }

    // --- Clawback operations ---

    /// Executes a regulatory clawback (token burn) against an address.
    /// @param caller Must be the registered ClawbackAdmin (auth).
    /// @param from Address to seize tokens from.
    /// @param amount Amount to clawback (positive).
    /// @param reason Regulatory reason code (enum value).
    /// @param jurisdiction Optional jurisdiction (uses default if None).
    /// @param legal_reference Optional legal authority reference.
    /// @param notes Optional compliance notes.
    pub fn clawback(
        e: Env,
        caller: Address,
        from: Address,
        amount: i128,
        reason: ClawbackReason,
        jurisdiction: Option<Jurisdiction>,
        legal_reference: Option<String>,
        notes: Option<String>,
    ) {
        clawback(e, caller, from, amount, reason, jurisdiction, legal_reference, notes);
    }

    /// Returns a specific clawback audit record by ID.
    pub fn get_clawback_record(e: Env, record_id: u64) -> Option<ClawbackRecord> {
        get_clawback_record(&e, record_id)
    }

    /// Returns the most recent clawback records (up to limit).
    pub fn get_recent_clawbacks(e: Env, limit: u32) -> Vec<ClawbackRecord> {
        get_recent_clawbacks(&e, limit)
    }

    /// Returns clawback records for a specific address with pagination.
    pub fn get_clawbacks_for_address(e: Env, addr: Address, limit: u32, offset: u32) -> Vec<ClawbackRecord> {
        get_clawbacks_for_address(&e, addr, limit, offset)
    }

    /// Returns the total number of clawback records.
    pub fn get_clawback_count(e: Env) -> u64 {
        get_clawback_count(&e)
    }
}

// Helper: convert ClawbackReason to string
fn reason_to_string(e: &Env, reason: ClawbackReason) -> String {
    match reason {
        ClawbackReason::Fraud => String::from_str(e, "fraud"),
        ClawbackReason::Sanctions => String::from_str(e, "sanctions"),
        ClawbackReason::CourtOrder => String::from_str(e, "court_order"),
        ClawbackReason::Regulatory => String::from_str(e, "regulatory"),
        ClawbackReason::AmlSeizure => String::from_str(e, "aml_seizure"),
        ClawbackReason::TerrorismFinancing => String::from_str(e, "terrorism_financing"),
        ClawbackReason::TaxEvasion => String::from_str(e, "tax_evasion"),
        ClawbackReason::Other => String::from_str(e, "other"),
    }
}

// Helper: convert Jurisdiction to string
fn jurisdiction_to_string(e: &Env, jurisdiction: &Jurisdiction) -> String {
    match *jurisdiction {
        Jurisdiction::US => String::from_str(e, "US"),
        Jurisdiction::EU => String::from_str(e, "EU"),
        Jurisdiction::UK => String::from_str(e, "UK"),
        Jurisdiction::CA => String::from_str(e, "CA"),
        Jurisdiction::SG => String::from_str(e, "SG"),
        Jurisdiction::CH => String::from_str(e, "CH"),
        Jurisdiction::JP => String::from_str(e, "JP"),
        Jurisdiction::OFFSHORE => String::from_str(e, "OFFSHORE"),
        Jurisdiction::GLOBAL => String::from_str(e, "GLOBAL"),
        Jurisdiction::OTHER => String::from_str(e, "OTHER"),
    }
}
