//! # SoroMint Staking Contract
//!
//! This contract allows users to stake SMT tokens to earn yield.
//! Yield is calculated based on the amount staked and the time elapsed.
//! The reward token can be the same as the staking token or a different asset.

use soroban_sdk::{
    contract, contractimpl, contracttype, symbol_short, token, Address, Env, String, Symbol,
};

#[contracttype]
#[derive(Clone)]
enum DataKey {
    Admin,
    StakingToken,
    RewardToken,
    RewardRate,
    LastUpdateTime,
    RewardPerTokenStored,
    TotalStaked,
    StakeBalance(Address),
    UserRewardPerTokenPaid(Address),
    Rewards(Address),
}

const REWARD_PRECISION: i128 = 1_000_000_000;

#[contract]
pub struct StakingContract;

#[contractimpl]
impl StakingContract {
    /// Initializes the staking contract.
    ///
    /// # Arguments
    /// * `admin` - Contract administrator.
    /// * `staking_token` - Token to be staked (e.g., SMT).
    /// * `reward_token` - Token distributed as yield.
    /// * `reward_rate` - Yield amount per second (scaled).
    pub fn initialize(
        e: Env,
        admin: Address,
        staking_token: Address,
        reward_token: Address,
        reward_rate: i128,
    ) {
        if e.storage().instance().has(&DataKey::Admin) {
            panic!("already initialized");
        }
        e.storage().instance().set(&DataKey::Admin, &admin);
        e.storage().instance().set(&DataKey::StakingToken, &staking_token);
        e.storage().instance().set(&DataKey::RewardToken, &reward_token);
        e.storage().instance().set(&DataKey::RewardRate, &reward_rate);
        e.storage().instance().set(&DataKey::LastUpdateTime, &e.ledger().timestamp());
        e.storage().instance().set(&DataKey::RewardPerTokenStored, &0i128);
        e.storage().instance().set(&DataKey::TotalStaked, &0i128);
    }

    /// Deposits tokens for staking.
    pub fn stake(e: Env, from: Address, amount: i128) {
        from.require_auth();
        Self::update_reward_internal(&e, Some(from.clone()));

        let staking_token: Address = e.storage().instance().get(&DataKey::StakingToken).unwrap();
        let client = token::Client::new(&e, &staking_token);
        client.transfer(&from, &e.current_contract_address(), &amount);

        let total: i128 = e.storage().instance().get(&DataKey::TotalStaked).unwrap_or(0);
        e.storage().instance().set(&DataKey::TotalStaked, &(total + amount));

        let balance: i128 = e.storage().persistent().get(&DataKey::StakeBalance(from.clone())).unwrap_or(0);
        e.storage().persistent().set(&DataKey::StakeBalance(from), &(balance + amount));
    }

    /// Withdraws staked tokens.
    pub fn withdraw(e: Env, to: Address, amount: i128) {
        to.require_auth();
        Self::update_reward_internal(&e, Some(to.clone()));

        let balance: i128 = e.storage().persistent().get(&DataKey::StakeBalance(to.clone())).unwrap_or(0);
        if amount > balance {
            panic!("insufficient balance");
        }
        e.storage().persistent().set(&DataKey::StakeBalance(to.clone()), &(balance - amount));

        let total: i128 = e.storage().instance().get(&DataKey::TotalStaked).unwrap_or(0);
        e.storage().instance().set(&DataKey::TotalStaked, &(total - amount));

        let staking_token: Address = e.storage().instance().get(&DataKey::StakingToken).unwrap();
        let client = token::Client::new(&e, &staking_token);
        client.transfer(&e.current_contract_address(), &to, &amount);
    }

    /// Claims all accumulated rewards for the caller.
    pub fn claim_reward(e: Env, to: Address) {
        to.require_auth();
        Self::update_reward_internal(&e, Some(to.clone()));

        let reward: i128 = e.storage().persistent().get(&DataKey::Rewards(to.clone())).unwrap_or(0);
        if reward > 0 {
            e.storage().persistent().set(&DataKey::Rewards(to.clone()), &0i128);
            let reward_token: Address = e.storage().instance().get(&DataKey::RewardToken).unwrap();
            let client = token::Client::new(&e, &reward_token);
            client.transfer(&e.current_contract_address(), &to, &reward);
            
            e.events().publish(
                (symbol_short!("reward"), to),
                reward
            );
        }
    }

    /// Updates the reward rate. Only the admin can call this.
    pub fn set_reward_rate(e: Env, new_rate: i128) {
        let admin: Address = e.storage().instance().get(&DataKey::Admin).unwrap();
        admin.require_auth();
        
        Self::update_reward_internal(&e, None);
        e.storage().instance().set(&DataKey::RewardRate, &new_rate);
    }

    /// Returns the earned reward for a user.
    pub fn earned(e: Env, user: Address) -> i128 {
        let rpt = Self::reward_per_token_internal(&e);
        let user_paid: i128 = e.storage().persistent().get(&DataKey::UserRewardPerTokenPaid(user.clone())).unwrap_or(0);
        let balance: i128 = e.storage().persistent().get(&DataKey::StakeBalance(user.clone())).unwrap_or(0);
        let stored_reward: i128 = e.storage().persistent().get(&DataKey::Rewards(user)).unwrap_or(0);

        stored_reward + (balance * (rpt - user_paid) / REWARD_PRECISION)
    }

    /// View function for total amount staked.
    pub fn total_staked(e: Env) -> i128 {
        e.storage().instance().get(&DataKey::TotalStaked).unwrap_or(0)
    }

    /// View function for user's staked balance.
    pub fn balance_of(e: Env, user: Address) -> i128 {
        e.storage().persistent().get(&DataKey::StakeBalance(user)).unwrap_or(0)
    }

    /// Returns the contract version.
    pub fn version(e: Env) -> String {
        String::from_str(&e, "1.0.0")
    }

    /// Returns the contract status.
    pub fn status(e: Env) -> String {
        String::from_str(&e, "alive")
    }

    // --- Internal Helpers ---

    fn reward_per_token_internal(e: &Env) -> i128 {
        let total: i128 = e.storage().instance().get(&DataKey::TotalStaked).unwrap_or(0);
        let stored_rpt: i128 = e.storage().instance().get(&DataKey::RewardPerTokenStored).unwrap_or(0);
        
        if total == 0 {
            return stored_rpt;
        }

        let last_time: u64 = e.storage().instance().get(&DataKey::LastUpdateTime).unwrap();
        let now = e.ledger().timestamp();
        
        if now <= last_time {
            return stored_rpt;
        }

        let reward_rate: i128 = e.storage().instance().get(&DataKey::RewardRate).unwrap();
        let duration = (now - last_time) as i128;
        
        stored_rpt + (duration * reward_rate * REWARD_PRECISION / total)
    }

    fn update_reward_internal(e: &Env, user: Option<Address>) {
        let rpt = Self::reward_per_token_internal(e);
        e.storage().instance().set(&DataKey::RewardPerTokenStored, &rpt);
        e.storage().instance().set(&DataKey::LastUpdateTime, &e.ledger().timestamp());

        if let Some(addr) = user {
            let reward = Self::earned(e.clone(), addr.clone());
            e.storage().persistent().set(&DataKey::Rewards(addr.clone()), &reward);
            e.storage().persistent().set(&DataKey::UserRewardPerTokenPaid(addr), &rpt);
        }
    }
}