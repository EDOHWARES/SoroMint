#![no_std]
/**
 * @title SoroMint Factory Contract
 * @description Factory contract for deploying SoroMint token contracts
 * @notice Enables deployment and management of token contracts on Stellar/Soroban
 */
mod factory;

pub use crate::factory::{TokenFactory, TokenFactoryClient};

#[cfg(test)]
mod test_factory;

#[cfg(test)]
/// @notice Integration tests for cross-contract interactions
/// @dev Tests complex scenarios involving factory and token contracts
mod test_integration;
