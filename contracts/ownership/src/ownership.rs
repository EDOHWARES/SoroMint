#![no_std]

use soroban_sdk::{contracttype, symbol_short, Address, Env, Symbol};

#[cfg(test)]
mod test_ownership;

#[contracttype]
#[derive(Clone)]
enum DataKey {
    Owner,
    PendingOwner,
}

const OWNER_TRANSFERRED: Symbol = symbol_short!("owner_tr");
const OWNER_PENDING: Symbol = symbol_short!("owner_pe");

/// Returns the current owner address.
pub fn get_owner(e: &Env) -> Address {
    e.storage()
        .instance()
        .get(&DataKey::Owner)
        .expect("Owner not initialized")
}

/// Sets the initial owner address. Only callable if owner is not yet set.
pub fn initialize_owner(e: &Env, owner: Address) {
    if e.storage().instance().has(&DataKey::Owner) {
        panic!("Owner already initialized");
    }
    e.storage().instance().set(&DataKey::Owner, &owner);
}

/// Returns the pending owner address, if any.
pub fn get_pending_owner(e: &Env) -> Option<Address> {
    e.storage().instance().get(&DataKey::PendingOwner)
}

/// Initiates the transfer of ownership to a new address.
/// Step 1 of the handshake.
///
/// # Arguments
/// * `new_owner` - The address to which ownership will be transferred.
pub fn transfer_ownership(e: Env, new_owner: Address) {
    let owner: Address = get_owner(&e);
    owner.require_auth();

    e.storage().instance().set(&DataKey::PendingOwner, &new_owner);
    
    e.events().publish(
        (OWNER_PENDING, owner),
        new_owner
    );
}

/// Accepts the transfer of ownership.
/// Step 2 of the handshake.
///
/// # Panics
/// Panics if no pending owner is set or if the caller is not the pending owner.
pub fn accept_ownership(e: Env) {
    let pending_owner: Address = get_pending_owner(&e).expect("No pending owner");
    pending_owner.require_auth();

    let old_owner: Address = get_owner(&e);
    e.storage().instance().set(&DataKey::Owner, &pending_owner);
    e.storage().instance().remove(&DataKey::PendingOwner);

    e.events().publish(
        (OWNER_TRANSFERRED, old_owner),
        pending_owner
    );
}

/// Helper to require the caller to be the current owner.
pub fn require_owner(e: &Env) {
    let owner: Address = get_owner(e);
    owner.require_auth();
}
