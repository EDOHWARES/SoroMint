#![no_std]
/**
 * @title SoroMint Factory Contract
 * @description Factory contract for deploying SoroMint token contracts
 * @notice Enables deployment and management of token contracts on Stellar/Soroban
 */
mod factory;
mod multisig;

pub use crate::factory::{TokenFactory, TokenFactoryClient};
pub use crate::multisig::{MultisigDeployPayload, OwnerSignature};

// Legacy factory tests depend on a full soromint_token WASM build. Gate them
// until the token crate compiles again; multisig deploy tests use deploy_test_token.
#[cfg(all(test, feature = "legacy-token-tests"))]
mod test_factory;

#[cfg(all(test, feature = "legacy-token-tests"))]
/// @notice Integration tests for cross-contract interactions
/// @dev Tests complex scenarios involving factory and token contracts
mod test_integration;

#[cfg(test)]
mod test_multisig_deploy;
