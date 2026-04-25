//! # Compliance Contract Events Module
//!
//! Provides structured event emission for compliance operations including
//! clawback actions with full regulatory audit metadata.

use soroban_sdk::{symbol_short, Address, Env, String, Symbol};

/// Emitted when a clawback action is executed for regulatory compliance.
///
/// Topics:
/// - "clwbk" (clawback event symbol)
/// - executor: Address of the clawback admin who executed
/// - from: Address from which tokens were seized
///
/// Data:
/// - amount: i128 amount of tokens burned
/// - reason: String reason code (e.g., "fraud", "sanctions", "court_order")
/// - jurisdiction: String jurisdiction code (e.g., "US", "EU", "GLOBAL")
/// - legal_reference: Optional String reference to legal authority/case number
/// - notes: Optional free-text notes
/// - timestamp: u64 ledger timestamp
pub fn emit_clawback_executed(
    e: &Env,
    executor: &Address,
    from: &Address,
    amount: i128,
    reason: &String,
    jurisdiction: &String,
    legal_reference: &Option<String>,
    notes: &Option<String>,
    timestamp: u64,
) {
    let topics = (
        symbol_short!("clwbk"),
        executor.clone(),
        from.clone(),
    );
    e.events().publish(
        topics,
        (
            amount,
            reason.clone(),
            jurisdiction.clone(),
            legal_reference.clone(),
            notes.clone(),
            timestamp,
        ),
    );
}

/// Emitted when the compliance configuration is updated.
pub fn emit_config_updated(
    e: &Env,
    admin: &Address,
    field: &str,
    old_value: String,
    new_value: String,
) {
    let topics = (symbol_short!("cfg_upd"), admin.clone());
    let field_sym = Symbol::new(e, field);
    e.events().publish(topics, (field_sym, old_value, new_value));
}

/// Emitted when the token contract address is configured.
pub fn emit_token_set(e: &Env, admin: &Address, token_address: &Address) {
    let topics = (symbol_short!("token_set"), admin.clone());
    e.events().publish(topics, token_address.clone());
}

/// Emitted when the clawback admin is changed.
pub fn emit_clawback_admin_set(e: &Env, admin: &Address, new_clawback_admin: &Address) {
    let topics = (symbol_short!("cb_admin"), admin.clone());
    e.events().publish(topics, new_clawback_admin.clone());
}

/// Emitted when a blacklist status is updated (log from compliance.rs).
pub fn emit_blacklist_updated(
    e: &Env,
    admin: &Address,
    addr: &Address,
    banned: bool,
) {
    let topics = (symbol_short!("bl_upd"), admin.clone());
    e.events().publish(topics, (addr.clone(), banned));
}
