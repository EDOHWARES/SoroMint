#![no_std]

use soroban_sdk::{contracttype, symbol_short, Address, Env, Symbol};

#[cfg(test)]
mod test_lifecycle;

#[contracttype]
#[derive(Clone)]
enum DataKey {
    IsPaused,
}

const SYS_PAUSE: Symbol = symbol_short!("sys_pause");
const SYS_UNPAUSE: Symbol = symbol_short!("sys_unp");

/// Pauses the contract operations.
///
/// # Arguments
/// * `admin` - The address authorized to pause the contract.
///
/// # Authorization
/// Requires `admin` to authenticate.
pub fn pause(e: Env, admin: Address) {
    admin.require_auth();
    // In a full integration, we'd check if `admin` has the Pauser or Admin role.
    // Here we just record that the contract is paused.
    e.storage().persistent().set(&DataKey::IsPaused, &true);

    e.events().publish((SYS_PAUSE,), admin);
}

/// Unpauses the contract operations.
///
/// # Arguments
/// * `admin` - The address authorized to unpause the contract.
///
/// # Authorization
/// Requires `admin` to authenticate.
pub fn unpause(e: Env, admin: Address) {
    admin.require_auth();
    e.storage().persistent().set(&DataKey::IsPaused, &false);

    e.events().publish((SYS_UNPAUSE,), admin);
}

/// Checks if the contract is currently paused.
pub fn is_paused(e: &Env) -> bool {
    e.storage().persistent().get(&DataKey::IsPaused).unwrap_or(false)
}

/// Asserts that the contract is NOT paused.
///
/// # Panics
/// Panics with "Contract is paused" if `is_paused` returns true.
pub fn require_not_paused(e: &Env) {
    if is_paused(e) {
        panic!("Contract is paused");
    }
}
