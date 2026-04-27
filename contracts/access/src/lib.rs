//! SoroMint Access Control Library
//!
//! This library provides role-based access control (RBAC) and multi-signature
//! authorization for high-risk administrative operations.

#![no_std]

mod access;
mod multisig;

pub use access::{AccessContract, Role};
pub use multisig::MultiSigAccessControl;

#[cfg(test)]
mod test_access;

#[cfg(test)]
mod test_multisig;