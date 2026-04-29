//! # SoroMint Dividend Distribution Contract
//!
//! ## Overview
//!
//! This contract allows a token issuer to deposit XLM (in stroops) which is then
//! distributed proportionally to all SoroMint token holders based on their share
//! of the total token supply at the time of deposit.
//!
//! ## Algorithm — Dividends-Per-Share (DPS) Accumulator
//!
//! The key insight is that on-chain contracts cannot enumerate all token holders.
//! Instead of tracking each holder, we maintain a global **dividends-per-share**
//! accumulator. Each holder independently claims by comparing the current global
//! DPS to the DPS value recorded at their last claim (their "debt pointer").
//!
//! ```text
//! On deposit:
//!     global_dps += (xlm_amount * PRECISION) / total_supply
//!
//! On claim by holder:
//!     claimable = (holder_balance * (global_dps - holder_debt)) / PRECISION
//!     holder_debt = global_dps   -- reset pointer
//! ```
//!
//! This is O(1) per deposit and O(1) per claim — no holder enumeration needed.
//! This is the same pattern used by Synthetix and most on-chain reward protocols.
//!
//! ## XLM Handling
//!
//! In Soroban, XLM is represented as a SEP-41 token at a well-known contract
//! address. The caller must pre-approve this contract to spend `amount` stroops
//! from their account before calling `deposit()`. Likewise, `claim()` transfers
//! XLM out of this contract's own balance to the holder.
//!
//! ## Caller Responsibilities
//!
//! The `deposit()` and `claim()` functions accept `total_supply` and
//! `holder_balance` as parameters rather than performing cross-contract reads
//! internally. This reduces compute units. The frontend/backend is expected to
//! read these values from the token contract first, then pass them in.

#![no_std]

mod events;

#[cfg(test)]
mod test;

use soroban_sdk::{contract, contractimpl, contracttype, token, Address, Env, String};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/// Scaling factor used to prevent integer truncation during DPS calculations.
/// With 10^13 precision, even a single stroop distributed over 10^14 token
/// units (10 million tokens at 7 decimals) still yields a non-zero increment.
const PRECISION: i128 = 10_000_000_000_000i128;

// ---------------------------------------------------------------------------
// Storage Keys
// ---------------------------------------------------------------------------

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    /// The administrator address (the token issuer).
    Admin,
    /// Address of the SoroMint token contract whose holders receive dividends.
    TokenContract,
    /// The native XLM token contract address (set at init, not hardcoded for
    /// testnet/mainnet portability).
    XlmToken,
    /// Cumulative dividends-per-share accumulator (scaled × PRECISION).
    GlobalDps,
    /// Running total of XLM (stroops) ever deposited into this contract.
    TotalDistributed,
    /// Per-holder: the GlobalDps value at the time of their last claim.
    /// This is the "debt pointer" that tracks what they have already been
    /// credited for.
    HolderDebt(Address),
}

// ---------------------------------------------------------------------------
// Contract
// ---------------------------------------------------------------------------

#[contract]
pub struct DividendDistributor;

#[contractimpl]
impl DividendDistributor {
    // -----------------------------------------------------------------------
    // Admin / Lifecycle
    // -----------------------------------------------------------------------

    /// Initialize the contract. Must be called exactly once.
    ///
    /// # Arguments
    /// * `admin`          – The issuer who will be allowed to deposit dividends.
    /// * `token_contract` – Address of the SoroMint token whose holders will
    ///                      receive distributions.
    /// * `xlm_token`      – Address of the native XLM SEP-41 token contract.
    ///                      On testnet this is the well-known SAC address for XLM.
    pub fn initialize(e: Env, admin: Address, token_contract: Address, xlm_token: Address) {
        if e.storage().instance().has(&DataKey::Admin) {
            panic!("already initialized");
        }

        e.storage().instance().set(&DataKey::Admin, &admin);
        e.storage()
            .instance()
            .set(&DataKey::TokenContract, &token_contract);
        e.storage().instance().set(&DataKey::XlmToken, &xlm_token);
        e.storage().instance().set(&DataKey::GlobalDps, &0i128);
        e.storage()
            .instance()
            .set(&DataKey::TotalDistributed, &0i128);

        events::emit_initialized(&e, &admin, &token_contract);
    }

    // -----------------------------------------------------------------------
    // Core: Deposit
    // -----------------------------------------------------------------------

    /// Deposit XLM to be distributed proportionally to all token holders.
    ///
    /// The caller must have pre-approved this contract to spend `amount` stroops
    /// of XLM on their behalf (via `xlm_token.approve(...)`).
    ///
    /// # Arguments
    /// * `depositor`    – The address funding the distribution (must be the admin
    ///                    or any authorized issuer). Must `require_auth`.
    /// * `amount`       – The number of XLM stroops to deposit.
    /// * `total_supply` – The current total token supply (read from the token
    ///                    contract by the caller before invoking this function).
    ///
    /// # Panics
    /// * `"already initialized"` — if called more than once.
    /// * `"amount must be positive"` — if `amount` ≤ 0.
    /// * `"no token supply"` — if `total_supply` ≤ 0 (no holders to receive).
    pub fn deposit(e: Env, depositor: Address, amount: i128, total_supply: i128) {
        depositor.require_auth();

        if amount <= 0 {
            panic!("amount must be positive");
        }
        if total_supply <= 0 {
            panic!("no token supply");
        }

        // Pull XLM from depositor into this contract.
        let xlm_token: Address = e.storage().instance().get(&DataKey::XlmToken).unwrap();
        let xlm_client = token::Client::new(&e, &xlm_token);
        xlm_client.transfer(&depositor, &e.current_contract_address(), &amount);

        // Increment the global DPS accumulator.
        //   dps_increment = (amount * PRECISION) / total_supply
        let dps_increment = amount
            .checked_mul(PRECISION)
            .expect("dps overflow")
            .checked_div(total_supply)
            .expect("div by zero");

        let old_dps: i128 = e.storage().instance().get(&DataKey::GlobalDps).unwrap();
        let new_dps = old_dps.checked_add(dps_increment).expect("dps overflow");
        e.storage().instance().set(&DataKey::GlobalDps, &new_dps);

        // Update total distributed counter.
        let old_total: i128 = e
            .storage()
            .instance()
            .get(&DataKey::TotalDistributed)
            .unwrap();
        let new_total = old_total.checked_add(amount).expect("total overflow");
        e.storage()
            .instance()
            .set(&DataKey::TotalDistributed, &new_total);

        events::emit_deposited(&e, &depositor, amount, new_dps, new_total);
    }

    // -----------------------------------------------------------------------
    // Core: Claim
    // -----------------------------------------------------------------------

    /// Claim all accrued XLM dividends for `holder`.
    ///
    /// If the holder has nothing to claim, this function returns 0 without
    /// panicking or reverting — it is always safe to call.
    ///
    /// # Arguments
    /// * `holder`        – The holder claiming their rewards. Must `require_auth`.
    /// * `holder_balance`– The holder's current token balance (read from the
    ///                     token contract by the caller before invoking).
    ///
    /// # Returns
    /// The number of XLM stroops transferred to the holder.
    pub fn claim(e: Env, holder: Address, holder_balance: i128) -> i128 {
        holder.require_auth();

        let claimable = Self::compute_claimable(&e, &holder, holder_balance);

        // Update the holder's debt pointer regardless of claimable amount so
        // that future deposits are not double-counted.
        let current_dps: i128 = e.storage().instance().get(&DataKey::GlobalDps).unwrap();
        e.storage()
            .persistent()
            .set(&DataKey::HolderDebt(holder.clone()), &current_dps);

        if claimable <= 0 {
            return 0;
        }

        // Transfer XLM from this contract's balance to the holder.
        let xlm_token: Address = e.storage().instance().get(&DataKey::XlmToken).unwrap();
        let xlm_client = token::Client::new(&e, &xlm_token);
        xlm_client.transfer(&e.current_contract_address(), &holder, &claimable);

        events::emit_claimed(&e, &holder, claimable);

        claimable
    }

    // -----------------------------------------------------------------------
    // Views
    // -----------------------------------------------------------------------

    /// Returns the amount of XLM stroops claimable by `holder` right now.
    ///
    /// This is a read-only function — it does not mutate any state.
    ///
    /// # Arguments
    /// * `holder`         – The holder address to query.
    /// * `holder_balance` – The holder's current token balance.
    pub fn claimable(e: Env, holder: Address, holder_balance: i128) -> i128 {
        Self::compute_claimable(&e, &holder, holder_balance)
    }

    /// Returns the current global dividends-per-share accumulator value
    /// (scaled by PRECISION = 10^13).
    pub fn global_dps(e: Env) -> i128 {
        e.storage()
            .instance()
            .get(&DataKey::GlobalDps)
            .unwrap_or(0)
    }

    /// Returns the total XLM (in stroops) ever deposited into this contract.
    pub fn total_distributed(e: Env) -> i128 {
        e.storage()
            .instance()
            .get(&DataKey::TotalDistributed)
            .unwrap_or(0)
    }

    /// Returns the DPS debt pointer for a specific holder (their last-claim DPS).
    /// Primarily useful for off-chain accounting and debugging.
    pub fn holder_debt(e: Env, holder: Address) -> i128 {
        e.storage()
            .persistent()
            .get(&DataKey::HolderDebt(holder))
            .unwrap_or(0)
    }

    /// Returns the address of the token contract this distributor is linked to.
    pub fn token_contract(e: Env) -> Address {
        e.storage().instance().get(&DataKey::TokenContract).unwrap()
    }

    /// Returns the admin address.
    pub fn admin(e: Env) -> Address {
        e.storage().instance().get(&DataKey::Admin).unwrap()
    }

    pub fn version(e: Env) -> String {
        String::from_str(&e, "1.0.0")
    }

    pub fn status(e: Env) -> String {
        String::from_str(&e, "alive")
    }

    // -----------------------------------------------------------------------
    // Internal Helpers
    // -----------------------------------------------------------------------

    /// Computes how many XLM stroops `holder` can claim right now.
    ///
    /// Formula:
    ///   claimable = (holder_balance × (global_dps − holder_debt)) / PRECISION
    ///
    /// The division by PRECISION reverses the scaling applied during `deposit()`.
    fn compute_claimable(e: &Env, holder: &Address, holder_balance: i128) -> i128 {
        if holder_balance <= 0 {
            return 0;
        }

        let global_dps: i128 = e.storage().instance().get(&DataKey::GlobalDps).unwrap_or(0);
        let holder_debt: i128 = e
            .storage()
            .persistent()
            .get(&DataKey::HolderDebt(holder.clone()))
            .unwrap_or(0);

        let dps_delta = global_dps.saturating_sub(holder_debt);
        if dps_delta == 0 {
            return 0;
        }

        holder_balance
            .checked_mul(dps_delta)
            .expect("claimable overflow")
            .checked_div(PRECISION)
            .expect("precision div failed")
    }

}

