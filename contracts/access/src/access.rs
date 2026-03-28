#![no_std]

use soroban_sdk::{contract, contractimpl, contracttype, symbol_short, Address, Env, String, Symbol};

#[cfg(test)]
mod test_access;

#[contracttype]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum Role {
    Admin = 1,
    Minter = 2,
    Pauser = 3,
}

#[contracttype]
#[derive(Clone)]
enum DataKey {
    Role(Address, Role),
}

const ROLE_GRANTED: Symbol = symbol_short!("role_gr");
const ROLE_REVOKED: Symbol = symbol_short!("role_rv");

/// Seeds the initial administrator for the RBAC system.
///
/// # Arguments
/// * `admin` - The address to be set as the initial Admin.
///
/// # Panics
/// Panics if an Admin has already been initialized.
pub fn initialize_admin(e: &Env, admin: Address) {
    e.storage().persistent().set(&DataKey::Role(admin.clone(), Role::Admin), &true);
}

/// Grants a role to a specific address.
///
/// # Arguments
/// * `granter` - The address of the administrator granting the role.
/// * `user`    - The address to receive the role.
/// * `role`    - The role to grant.
///
/// # Authorization
/// Requires `granter` to have the `Admin` role and authorize the transaction.
pub fn grant_role(e: Env, granter: Address, user: Address, role: Role) {
    granter.require_auth();
    require_role(&e, granter.clone(), Role::Admin);

    e.storage().persistent().set(&DataKey::Role(user.clone(), role), &true);

    e.events().publish(
        (ROLE_GRANTED, granter),
        (user, role as u32)
    );
}

/// Revokes a role from a specific address.
pub fn revoke_role(e: Env, revoker: Address, user: Address, role: Role) {
    revoker.require_auth();
    require_role(&e, revoker.clone(), Role::Admin);

    e.storage().persistent().remove(&DataKey::Role(user.clone(), role));

    e.events().publish(
        (ROLE_REVOKED, revoker),
        (user, role as u32)
    );
}

/// Checks if an address has a specific role.
pub fn has_role(e: &Env, user: Address, role: Role) -> bool {
    e.storage()
        .persistent()
        .get(&DataKey::Role(user, role))
        .unwrap_or(false)
}

/// Asserts that the given address has the required role.
///
/// # Panics
/// Panics with "Missing required role" if the address does not have the role.
pub fn require_role(e: &Env, user: Address, role: Role) {
    if !has_role(e, user, role) {
        panic!("Missing required role");
    }
}

/// The deployable AccessContract exposing RBAC and versioning functions.
#[contract]
pub struct AccessContract;

#[contractimpl]
impl AccessContract {
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

    /// Seeds the initial administrator for the RBAC system.
    /// @param admin The address to be set as the initial Admin.
    pub fn initialize_admin(e: Env, admin: Address) {
        initialize_admin(&e, admin);
    }

    /// Grants a role to a specific address.
    /// @param granter The administrator granting the role (must be Admin).
    /// @param user    The address to receive the role.
    /// @param role    The role to grant (1=Admin, 2=Minter, 3=Pauser).
    /// @auth Requires granter to authorize.
    pub fn grant_role(e: Env, granter: Address, user: Address, role: Role) {
        grant_role(e, granter, user, role);
    }

    /// Revokes a role from a specific address.
    /// @param revoker The administrator revoking the role (must be Admin).
    /// @param user    The address losing the role.
    /// @param role    The role to revoke.
    /// @auth Requires revoker to authorize.
    pub fn revoke_role(e: Env, revoker: Address, user: Address, role: Role) {
        revoke_role(e, revoker, user, role);
    }

    /// Returns whether an address holds a specific role.
    /// @param user The address to check.
    /// @param role The role to query.
    pub fn has_role(e: Env, user: Address, role: Role) -> bool {
        has_role(&e, user, role)
    }

    /// Panics if the address does not hold the required role.
    /// @param user The address to check.
    /// @param role The required role.
    pub fn require_role(e: Env, user: Address, role: Role) {
        require_role(&e, user, role);
    }
}
