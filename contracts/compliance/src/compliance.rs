#![no_std]

use soroban_sdk::{contract, contractimpl, contracttype, symbol_short, Address, Env, String, Symbol};

#[cfg(test)]
mod test_compliance;

#[contracttype]
#[derive(Clone)]
enum DataKey {
    Blacklisted(Address),
}

const BLACKLIST_UPDATED: Symbol = symbol_short!("bl_upd");

/// Sets the blacklist status for a specific address.
///
/// # Arguments
/// * `admin` - The address of the administrator (checked for auth).
/// * `addr`  - The address to update status for.
/// * `banned` - Boolean flag: true to blacklist, false to un-blacklist.
///
/// # Authorization
/// Requires `admin` to authorize the transaction.
pub fn set_blacklist_status(e: Env, admin: Address, addr: Address, banned: bool) {
    admin.require_auth();
    
    if banned {
        e.storage().persistent().set(&DataKey::Blacklisted(addr.clone()), &true);
    } else {
        e.storage().persistent().remove(&DataKey::Blacklisted(addr.clone()));
    }

    e.events().publish(
        (BLACKLIST_UPDATED, admin),
        (addr, banned)
    );
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

/// The deployable ComplianceContract exposing blacklist management and versioning.
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

    /// Sets the blacklist status for a specific address.
    /// @param admin  The administrator authorizing the change.
    /// @param addr   The address to update.
    /// @param banned True to blacklist, false to remove from blacklist.
    /// @auth Requires admin to authorize.
    pub fn set_blacklist_status(e: Env, admin: Address, addr: Address, banned: bool) {
        set_blacklist_status(e, admin, addr, banned);
    }

    /// Returns whether an address is blacklisted.
    /// @param addr The address to query.
    pub fn is_blacklisted(e: Env, addr: Address) -> bool {
        is_blacklisted(&e, addr)
    }

    /// Panics if the address is blacklisted.
    /// @param addr The address to check.
    pub fn require_not_blacklisted(e: Env, addr: Address) {
        require_not_blacklisted(&e, addr);
    }
}
