#![no_std]

use soroban_sdk::{contract, contractimpl, contracttype, symbol_short, Address, Env, String, Symbol};

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

/// @notice Initiates the transfer of ownership to a new address.
/// @dev Step 1 of the handshake. Optimizes gas by caching storage handles.
/// @param new_owner The address to which ownership will be transferred.
/// @auth Requires the current owner to authorize the transaction.
/// @emit owner_pe(owner, new_owner)
pub fn transfer_ownership(e: Env, new_owner: Address) {
    let instance = e.storage().instance();
    let owner: Address = instance.get(&DataKey::Owner).expect("Owner not initialized");
    owner.require_auth();

    instance.set(&DataKey::PendingOwner, &new_owner);
    
    e.events().publish(
        (OWNER_PENDING, owner),
        new_owner
    );
}

/// @notice Accepts the transfer of ownership.
/// @dev Step 2 of the handshake. Optimizes gas by caching instance storage and reducing lookups.
/// @auth Requires the pending owner to authorize the transaction.
/// @emit owner_tr(old_owner, pending_owner)
pub fn accept_ownership(e: Env) {
    let instance = e.storage().instance();
    let pending_owner: Address = instance.get(&DataKey::PendingOwner).expect("No pending owner");
    pending_owner.require_auth();

    let old_owner: Address = instance.get(&DataKey::Owner).expect("Owner not set");
    instance.set(&DataKey::Owner, &pending_owner);
    instance.remove(&DataKey::PendingOwner);

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

/// The deployable OwnershipContract exposing two-step ownership transfer and versioning.
#[contract]
pub struct OwnershipContract;

#[contractimpl]
impl OwnershipContract {
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

    /// Sets the initial owner. Panics if already initialized.
    /// @param owner The address to set as owner.
    pub fn initialize_owner(e: Env, owner: Address) {
        initialize_owner(&e, owner);
    }

    /// Initiates a two-step ownership transfer.
    /// @param new_owner The candidate new owner.
    /// @auth Requires current owner to authorize.
    pub fn transfer_ownership(e: Env, new_owner: Address) {
        transfer_ownership(e, new_owner);
    }

    /// Completes the ownership transfer. Must be called by the pending owner.
    /// @auth Requires pending owner to authorize.
    pub fn accept_ownership(e: Env) {
        accept_ownership(e);
    }

    /// Returns the current owner address.
    pub fn get_owner(e: Env) -> Address {
        get_owner(&e)
    }

    /// Returns the pending owner address, if any.
    pub fn get_pending_owner(e: Env) -> Option<Address> {
        get_pending_owner(&e)
    }
}
