//! # QuorumCredit Contract
//!
//! A Soroban contract implementing a credit system where validators (vouchers)
//! can stake on behalf of borrowers to enable loan requests.
//!
//! Key features:
//! - Vouchers can stake on behalf of borrowers
//! - Loan requests require minimum total stake threshold
//! - Rejects loans when total stake is below threshold

#![no_std]

use soroban_sdk::{contract, contractimpl, contracttype, symbol_short, Address, Env, Vec, Symbol};

#[cfg(test)]
mod test_quorum_credit;

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    /// Maps borrower address to their total staked amount
    BorrowerStake(Address),
    /// Maps (voucher, borrower) to the stake amount
    VoucherStake(Address, Address),
    /// Tracks which vouchers have staked for a borrower
    BorrowerVouchers(Address),
}

#[contracttype]
#[derive(Clone)]
pub enum ContractError {
    /// Returned when stake is insufficient for the requested loan
    InsufficientFunds = 1,
    /// Returned when the borrower address is invalid
    InvalidBorrower = 2,
    /// Returned when trying to unstake more than available
    InsufficientStake = 3,
}

const VOUCH_STAKED: Symbol = symbol_short!("vouch");
const LOAN_REQUESTED: Symbol = symbol_short!("loan");

/// The QuorumCredit Contract
#[contract]
pub struct QuorumCredit;

#[contractimpl]
impl QuorumCredit {
    /// Initializes the contract (no-op for this simple version).
    pub fn initialize(_e: Env) {
        // No initialization needed for this simple contract
    }

    /// Allows a voucher to stake on behalf of a borrower.
    ///
    /// # Arguments
    /// * `voucher`  - The address of the voucher (must authorize).
    /// * `borrower` - The address of the borrower receiving the stake.
    /// * `amount`   - The amount of stroops to stake.
    ///
    /// # Authorization
    /// Requires `voucher` to authorize the transaction.
    ///
    /// # Events
    /// Emits a `vouch_staked` event with voucher, borrower, and amount.
    pub fn vouch(e: Env, voucher: Address, borrower: Address, amount: i128) {
        voucher.require_auth();

        if amount <= 0 {
            panic!("stake amount must be positive");
        }

        // Update total stake for borrower
        let mut total_stake: i128 = e
            .storage()
            .persistent()
            .get(&DataKey::BorrowerStake(borrower.clone()))
            .unwrap_or(0);

        total_stake += amount;
        e.storage()
            .persistent()
            .set(&DataKey::BorrowerStake(borrower.clone()), &total_stake);

        // Update voucher-specific stake
        let mut voucher_stake: i128 = e
            .storage()
            .persistent()
            .get(&DataKey::VoucherStake(voucher.clone(), borrower.clone()))
            .unwrap_or(0);

        voucher_stake += amount;
        e.storage()
            .persistent()
            .set(&DataKey::VoucherStake(voucher.clone(), borrower.clone()), &voucher_stake);

        // Emit event
        e.events().publish((VOUCH_STAKED,), (voucher, borrower, amount));
    }

    /// Requests a loan for the borrower if total stake meets the threshold.
    ///
    /// # Arguments
    /// * `borrower`   - The address of the borrower requesting the loan.
    /// * `threshold`  - The minimum total stake required (in stroops).
    ///
    /// # Returns
    /// Returns `true` if the loan request is successful.
    ///
    /// # Errors
    /// Returns `ContractError::InsufficientFunds` if total stake < threshold.
    ///
    /// # Authorization
    /// Requires `borrower` to authorize the transaction.
    ///
    /// # Events
    /// Emits a `loan_requested` event with borrower, threshold, and success status.
    pub fn request_loan(e: Env, borrower: Address, threshold: i128) -> bool {
        borrower.require_auth();

        if threshold <= 0 {
            panic!("threshold must be positive");
        }

        // Get total stake for borrower
        let total_stake: i128 = e
            .storage()
            .persistent()
            .get(&DataKey::BorrowerStake(borrower.clone()))
            .unwrap_or(0);

        // Check if stake meets threshold
        if total_stake < threshold {
            panic!("InsufficientFunds");
        }

        // Emit success event
        e.events().publish((LOAN_REQUESTED,), (borrower, threshold, true));

        true
    }

    /// Returns the total stake amount for a borrower.
    ///
    /// # Arguments
    /// * `borrower` - The address of the borrower.
    ///
    /// # Returns
    /// The total amount of stroops staked for the borrower.
    pub fn get_total_stake(e: Env, borrower: Address) -> i128 {
        e.storage()
            .persistent()
            .get(&DataKey::BorrowerStake(borrower))
            .unwrap_or(0)
    }

    /// Returns the stake amount from a specific voucher for a borrower.
    ///
    /// # Arguments
    /// * `voucher`  - The address of the voucher.
    /// * `borrower` - The address of the borrower.
    ///
    /// # Returns
    /// The amount of stroops staked by the voucher for the borrower.
    pub fn get_voucher_stake(e: Env, voucher: Address, borrower: Address) -> i128 {
        e.storage()
            .persistent()
            .get(&DataKey::VoucherStake(voucher, borrower))
            .unwrap_or(0)
    }
}