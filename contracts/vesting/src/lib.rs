//! # SoroMint Token Vesting Contract
//!
//! Locks team/advisor tokens and releases them either:
//! - **Linearly** – proportional to elapsed time between `start` and `end`.
//! - **Milestone-based** – admin unlocks discrete tranches by calling
//!   `release_milestone`.
//!
//! ## Linear vesting
//! ```
//! vested = total_amount * (now - start) / (end - start)
//! claimable = vested - already_claimed
//! ```
//!
//! ## Milestone vesting
//! Admin pre-defines N milestones each with an `amount`. Calling
//! `release_milestone(id)` marks it as released; the beneficiary then calls
//! `claim` to pull the unlocked tokens.

#![no_std]

#[cfg(test)]
mod test;

use soroban_sdk::{
    contract, contractimpl, contracttype, symbol_short, token, Address, Env, String, Vec,
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum VestingKind {
    Linear,
    Milestone,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct Milestone {
    pub amount: i128,
    pub released: bool,
}

#[contracttype]
pub enum ConfigKey {
    Admin,
    Token,
    Beneficiary,
    Kind,
    TotalAmount,
    Start,
    End,
}

#[contracttype]
pub enum DataKey {
    Config(ConfigKey),
    Claimed,
    Milestones,
}

// ---------------------------------------------------------------------------
// Contract
// ---------------------------------------------------------------------------

#[contract]
pub struct Vesting;

#[contractimpl]
impl Vesting {
    /// Initialize a **linear** vesting schedule.
    pub fn init_linear(
        e: Env,
        admin: Address,
        token: Address,
        beneficiary: Address,
        total_amount: i128,
        start: u64,
        end: u64,
    ) {
        Self::assert_not_init(&e);
        if end <= start {
            panic!("end <= start");
        }
        admin.require_auth();
        // Deposit tokens into the contract
        token::Client::new(&e, &token).transfer(
            &admin,
            &e.current_contract_address(),
            &total_amount,
        );
        e.storage().instance().set(&DataKey::Config(ConfigKey::Admin), &admin);
        e.storage().instance().set(&DataKey::Config(ConfigKey::Token), &token);
        e.storage()
            .instance()
            .set(&DataKey::Config(ConfigKey::Beneficiary), &beneficiary);
        e.storage()
            .instance()
            .set(&DataKey::Config(ConfigKey::Kind), &VestingKind::Linear);
        e.storage()
            .instance()
            .set(&DataKey::Config(ConfigKey::TotalAmount), &total_amount);
        e.storage().instance().set(&DataKey::Config(ConfigKey::Start), &start);
        e.storage().instance().set(&DataKey::Config(ConfigKey::End), &end);
        e.storage().instance().set(&DataKey::Claimed, &0i128);
    }

    /// Initialize a **milestone** vesting schedule.
    pub fn init_milestone(
        e: Env,
        admin: Address,
        token: Address,
        beneficiary: Address,
        milestones: Vec<i128>,
    ) {
        Self::assert_not_init(&e);
        admin.require_auth();

        let mut total: i128 = 0;
        let mut ms: Vec<Milestone> = Vec::new(&e);
        for amt in milestones.iter() {
            total += amt;
            ms.push_back(Milestone { amount: amt, released: false });
        }

        token::Client::new(&e, &token).transfer(&admin, &e.current_contract_address(), &total);

        e.storage().instance().set(&DataKey::Config(ConfigKey::Admin), &admin);
        e.storage().instance().set(&DataKey::Config(ConfigKey::Token), &token);
        e.storage()
            .instance()
            .set(&DataKey::Config(ConfigKey::Beneficiary), &beneficiary);
        e.storage()
            .instance()
            .set(&DataKey::Config(ConfigKey::Kind), &VestingKind::Milestone);
        e.storage().instance().set(&DataKey::Config(ConfigKey::TotalAmount), &total);
        e.storage().instance().set(&DataKey::Claimed, &0i128);
        e.storage().persistent().set(&DataKey::Milestones, &ms);
    }

    /// Admin releases a milestone by index (milestone vesting only).
    pub fn release_milestone(e: Env, index: u32) {
        Self::require_admin(&e);
        let kind: VestingKind = e.storage().instance().get(&DataKey::Config(ConfigKey::Kind)).unwrap();
        if kind != VestingKind::Milestone {
            panic!("not milestone vesting");
        }
        let mut ms: Vec<Milestone> = e
            .storage()
            .persistent()
            .get(&DataKey::Milestones)
            .unwrap();
        let mut m = ms.get(index).expect("invalid milestone index");
        if m.released {
            panic!("already released");
        }
        m.released = true;
        ms.set(index, m.clone());
        e.storage().persistent().set(&DataKey::Milestones, &ms);
        e.events()
            .publish((symbol_short!("ms_rel"),), (index, m.amount));
    }

    /// Beneficiary claims all currently vested/released tokens.
    pub fn claim(e: Env) -> i128 {
        let beneficiary: Address = e.storage().instance().get(&DataKey::Config(ConfigKey::Beneficiary)).unwrap();
        beneficiary.require_auth();

        let claimable = Self::claimable_amount(&e);
        if claimable == 0 {
            panic!("nothing to claim");
        }

        let claimed: i128 = e.storage().instance().get(&DataKey::Claimed).unwrap();
        e.storage()
            .instance()
            .set(&DataKey::Claimed, &(claimed + claimable));

        let tok: Address = e.storage().instance().get(&DataKey::Config(ConfigKey::Token)).unwrap();
        token::Client::new(&e, &tok).transfer(
            &e.current_contract_address(),
            &beneficiary,
            &claimable,
        );

        e.events()
            .publish((symbol_short!("claimed"),), (beneficiary, claimable));
        claimable
    }

    /// Returns how many tokens can be claimed right now.
    pub fn claimable(e: Env) -> i128 {
        Self::claimable_amount(&e)
    }

    pub fn get_claimed(e: Env) -> i128 {
        e.storage().instance().get(&DataKey::Claimed).unwrap_or(0)
    }

    pub fn version(_e: Env) -> String {
        String::from_str(&_e, "1.0.0")
    }

    // -----------------------------------------------------------------------
    // Helpers
    // -----------------------------------------------------------------------

    fn claimable_amount(e: &Env) -> i128 {
        let kind: VestingKind = e.storage().instance().get(&DataKey::Config(ConfigKey::Kind)).unwrap();
        let claimed: i128 = e.storage().instance().get(&DataKey::Claimed).unwrap();

        match kind {
            VestingKind::Linear => {
                let total: i128 = e.storage().instance().get(&DataKey::Config(ConfigKey::TotalAmount)).unwrap();
                let start: u64 = e.storage().instance().get(&DataKey::Config(ConfigKey::Start)).unwrap();
                let end: u64 = e.storage().instance().get(&DataKey::Config(ConfigKey::End)).unwrap();
                let now = e.ledger().timestamp();
                if now <= start {
                    return 0;
                }
                let elapsed = (now.min(end) - start) as i128;
                let duration = (end - start) as i128;
                let vested = total * elapsed / duration;
                (vested - claimed).max(0)
            }
            VestingKind::Milestone => {
                let ms: Vec<Milestone> = e
                    .storage()
                    .persistent()
                    .get(&DataKey::Milestones)
                    .unwrap();
                let mut unlocked: i128 = 0;
                for m in ms.iter() {
                    if m.released {
                        unlocked += m.amount;
                    }
                }
                (unlocked - claimed).max(0)
            }
        }
    }

    fn assert_not_init(e: &Env) {
        if e.storage().instance().has(&DataKey::Config(ConfigKey::Admin)) {
            panic!("already initialized");
        }
    }

    fn require_admin(e: &Env) {
        let admin: Address = e.storage().instance().get(&DataKey::Config(ConfigKey::Admin)).unwrap();
        admin.require_auth();
    }
}
