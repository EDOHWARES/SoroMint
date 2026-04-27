//! # SoroMint Token Contract
//!
//! A Soroban-based token contract implementing the standard TokenInterface
//! with additional administrative controls and a configurable transfer tax.

#![no_std]

mod events;

use soroban_sdk::token::TokenInterface;
use soroban_sdk::{contract, contractimpl, contracttype, Address, BytesN, Env, String, Symbol, Vec};

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Admin,
    Allowance(Address, Address),
    Balance(Address),
    Name,
    Symbol,
    Decimals,
    Supply,
    MetadataHash,
    FeeConfig,
    // Multi-sig related keys
    MultiSigContract,
    HighRiskOperations,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct FeeConfig {
    pub enabled: bool,
    pub fee_bps: u32, // Basis points (100 = 1%, 1000 = 10%)
    pub treasury: Address,
}

#[contract]
pub struct SoroMintToken;

#[contractimpl]
impl SoroMintToken {
    /// Internal helpers
    fn read_balance(e: &Env, id: &Address) -> i128 {
        e.storage().persistent().get(&DataKey::Balance(id.clone())).unwrap_or(0)
    }

    fn read_allowance(e: &Env, from: &Address, spender: &Address) -> i128 {
        e.storage().persistent().get(&DataKey::Allowance(from.clone(), spender.clone())).unwrap_or(0)
    }

    fn write_balance(e: &Env, id: &Address, balance: i128) {
        e.storage().persistent().set(&DataKey::Balance(id.clone()), &balance);
    }

    fn write_allowance(e: &Env, from: &Address, spender: &Address, amount: i128) {
        e.storage().persistent().set(&DataKey::Allowance(from.clone(), spender.clone()), &amount);
    }

    fn move_balance(e: &Env, from: &Address, to: &Address, amount: i128) -> (i128, i128) {
        let from_balance = Self::read_balance(e, from);
        if from_balance < amount { panic!("insufficient balance"); }
        if from == to { return (from_balance, from_balance); }

        let mut amount_to_receive = amount;
        if let Some(fee_config) = e.storage().instance().get::<_, FeeConfig>(&DataKey::FeeConfig) {
            if fee_config.enabled && fee_config.fee_bps > 0 {
                let fee_amount = amount.checked_mul(fee_config.fee_bps as i128).unwrap().checked_div(10000).unwrap();
                if fee_amount > 0 {
                    let treasury_balance = Self::read_balance(e, &fee_config.treasury);
                    Self::write_balance(e, &fee_config.treasury, treasury_balance + fee_amount);
                    amount_to_receive -= fee_amount;
                    events::emit_fee_collected(e, from, &fee_config.treasury, fee_amount);
                }
            }
        }

        let new_from = from_balance - amount;
        let new_to = Self::read_balance(e, to) + amount_to_receive;
        Self::write_balance(e, from, new_from);
        Self::write_balance(e, to, new_to);
        (new_from, new_to)
    }

    /// Admin Functions
    pub fn initialize(e: Env, admin: Address, decimals: u32, name: String, symbol: String) {
        if e.storage().instance().has(&DataKey::Admin) { panic!("already initialized"); }
        e.storage().instance().set(&DataKey::Admin, &admin);
        e.storage().instance().set(&DataKey::Supply, &0i128);
        e.storage().instance().set(&DataKey::Name, &name);
        e.storage().instance().set(&DataKey::Symbol, &symbol);
        e.storage().instance().set(&DataKey::Decimals, &decimals);

        events::emit_initialized(&e, &admin, decimals, &name, &symbol);
    }

    pub fn mint(e: Env, to: Address, amount: i128) {
        soromint_lifecycle::require_not_paused(&e);
        if amount <= 0 { panic!("mint amount must be positive"); }
        let admin: Address = e.storage().instance().get(&DataKey::Admin).unwrap();
        admin.require_auth();

        let mut balance = Self::read_balance(&e, &to);
        balance += amount;
        Self::write_balance(&e, &to, balance);

        let mut supply: i128 = e.storage().instance().get(&DataKey::Supply).unwrap_or(0);
        supply += amount;
        e.storage().instance().set(&DataKey::Supply, &supply);
        events::emit_mint(&e, &admin, &to, amount, balance, supply);
    }

    pub fn transfer_ownership(e: Env, new_admin: Address) {
        let admin: Address = e.storage().instance().get(&DataKey::Admin).unwrap();
        admin.require_auth();
        e.storage().instance().set(&DataKey::Admin, &new_admin);
        events::emit_ownership_transfer(&e, &admin, &new_admin);
    }

    pub fn set_metadata_hash(e: Env, hash: String) {
        let admin: Address = e.storage().instance().get(&DataKey::Admin).unwrap();
        admin.require_auth();
        e.storage().instance().set(&DataKey::MetadataHash, &hash);
        // Using a simpler version of metadata update event for hash
        // events::emit_metadata_updated(&e, &admin, &hash); // This was in old code, but let's stick to update_metadata
    }

    pub fn metadata_hash(e: Env) -> Option<String> {
        e.storage().instance().get(&DataKey::MetadataHash)
    }

    pub fn set_fee_config(e: Env, enabled: bool, fee_bps: u32, treasury: Address) {
        let admin: Address = e.storage().instance().get(&DataKey::Admin).unwrap();
        admin.require_auth();
        if fee_bps > 1000 { panic!("fee percentage exceeds maximum cap of 10%"); }
        let config = FeeConfig { enabled, fee_bps, treasury: treasury.clone() };
        e.storage().instance().set(&DataKey::FeeConfig, &config);
        events::emit_fee_config_updated(&e, &admin, enabled, fee_bps, &treasury);
    }

    pub fn fee_config(e: Env) -> Option<FeeConfig> {
        e.storage().instance().get(&DataKey::FeeConfig)
    }

    pub fn version(e: Env) -> String { String::from_str(&e, "2.0.0") }
    pub fn status(e: Env) -> String { String::from_str(&e, "alive") }
    pub fn supply(e: Env) -> i128 { e.storage().instance().get(&DataKey::Supply).unwrap_or(0) }

    pub fn pause(e: Env) {
        let admin: Address = e.storage().instance().get(&DataKey::Admin).unwrap();
        soromint_lifecycle::pause(e, admin);
    }
    pub fn unpause(e: Env) {
        let admin: Address = e.storage().instance().get(&DataKey::Admin).unwrap();
        soromint_lifecycle::unpause(e, admin);
    }

    /// Extends the standard update_metadata with old/new values
    pub fn update_metadata(e: Env, new_name: String, new_symbol: String) {
        let admin: Address = e.storage().instance().get(&DataKey::Admin).unwrap();
        admin.require_auth();

        let old_name: String = e.storage().instance().get(&DataKey::Name).unwrap();
        let old_symbol: String = e.storage().instance().get(&DataKey::Symbol).unwrap();

        e.storage().instance().set(&DataKey::Name, &new_name);
        e.storage().instance().set(&DataKey::Symbol, &new_symbol);

        events::emit_metadata_updated(&e, &admin, &old_name, &old_symbol, &new_name, &new_symbol);
    }

    /// Sets the multi-signature contract address for high-risk operations.
    /// This enables multi-sig authorization for treasury withdrawals.
    ///
    /// # Arguments
    /// * `multisig_contract` - The address of the multi-sig access control contract.
    ///
    /// # Authorization
    /// Requires the current admin to authorize.
    pub fn set_multisig_contract(e: Env, multisig_contract: Address) {
        let admin: Address = e.storage().instance().get(&DataKey::Admin).unwrap();
        admin.require_auth();
        e.storage().instance().set(&DataKey::MultiSigContract, &multisig_contract);
        events::emit_multisig_configured(&e, &admin, &multisig_contract);
    }

    /// Returns the configured multi-sig contract address.
    pub fn multisig_contract(e: Env) -> Option<Address> {
        e.storage().instance().get(&DataKey::MultiSigContract)
    }

    /// Proposes a treasury withdrawal operation that requires multi-sig approval.
    /// This is a high-risk operation that distributes collected fees to the treasury.
    ///
    /// # Arguments
    /// * `operation_id` - A unique identifier for the operation.
    /// * `recipient`    - The address to receive the withdrawn funds.
    /// * `amount`       - The amount to withdraw.
    ///
    /// # Authorization
    /// Requires the proposer to be an authorized signer in the multi-sig contract.
    pub fn propose_treasury_withdrawal(e: Env, operation_id: BytesN<32>, recipient: Address, amount: i128) {
        let multisig: Address = e.storage().instance().get(&DataKey::MultiSigContract).expect("multisig not configured");
        
        // Call the multi-sig contract to propose the operation
        let action = Symbol::new(&e, "withdraw_treasury");
        let mut args = soroban_sdk::vec![&e];
        args.push_back(operation_id.clone().into_val(&e));
        args.push_back(action.into_val(&e));
        args.push_back(recipient.clone().into_val(&e));
        args.push_back(amount.into_val(&e));
        
        e.invoke_contract::<()>(&multisig, &Symbol::new(&e, "propose_operation"), args);
        
        events::emit_treasury_withdrawal_proposed(&e, &recipient, amount, &operation_id);
    }

    /// Executes a treasury withdrawal after multi-sig approval is obtained.
    ///
    /// # Arguments
    /// * `operation_id` - The unique identifier of the approved operation.
    /// * `recipient`    - The address to receive the withdrawn funds.
    /// * `amount`       - The amount to withdraw.
    ///
    /// # Returns
    /// Returns `true` if the withdrawal was successful.
    ///
    /// # Panics
    /// Panics if:
    /// - Multi-sig is not configured
    /// - The operation hasn't received enough approvals
    pub fn execute_treasury_withdrawal(e: Env, operation_id: BytesN<32>, recipient: Address, amount: i128) -> bool {
        let multisig: Address = e.storage().instance().get(&DataKey::MultiSigContract).expect("multisig not configured");
        
        // First verify the operation is approved via multi-sig contract
        let args = soroban_sdk::vec![&e, operation_id.clone().into_val(&e)];
        let approved: bool = e.invoke_contract(&multisig, &Symbol::new(&e, "execute_operation"), args);
        
        if !approved {
            panic!("multi-sig execution failed");
        }

        // Execute the actual transfer from treasury to recipient
        let fee_config: FeeConfig = e.storage().instance().get(&DataKey::FeeConfig).expect("fee config not set");
        let treasury_balance = Self::read_balance(&e, &fee_config.treasury);
        
        if treasury_balance < amount {
            panic!("insufficient treasury balance");
        }

        // Transfer from treasury to recipient
        Self::write_balance(&e, &fee_config.treasury, treasury_balance - amount);
        let recipient_balance = Self::read_balance(&e, &recipient);
        Self::write_balance(&e, &recipient, recipient_balance + amount);

        events::emit_treasury_withdrawal(&e, &recipient, amount, &operation_id);
        
        true
    }

    /// Simplified treasury withdrawal that checks multi-sig approval directly.
    /// This is the recommended way to withdraw fees.
    ///
    /// # Arguments
    /// * `operation_id` - The unique identifier of the approved operation.
    /// * `recipient`    - The address to receive the withdrawn funds.
    /// * `amount`       - The amount to withdraw.
    pub fn withdraw_treasury(e: Env, operation_id: BytesN<32>, recipient: Address, amount: i128) {
        let multisig: Address = e.storage().instance().get(&DataKey::MultiSigContract).expect("multisig not configured");
        
        // Verify the operation has been executed (approved) via multi-sig contract
        let args = soroban_sdk::vec![&e, operation_id.clone().into_val(&e)];
        let is_executed: bool = e.invoke_contract(&multisig, &Symbol::new(&e, "is_executed"), args);
        
        if !is_executed {
            panic!("operation not approved by multi-sig");
        }

        // Execute the actual transfer
        let fee_config: FeeConfig = e.storage().instance().get(&DataKey::FeeConfig).expect("fee config not set");
        let treasury_balance = Self::read_balance(&e, &fee_config.treasury);
        
        if treasury_balance < amount {
            panic!("insufficient treasury balance");
        }

        Self::write_balance(&e, &fee_config.treasury, treasury_balance - amount);
        let recipient_balance = Self::read_balance(&e, &recipient);
        Self::write_balance(&e, &recipient, recipient_balance + amount);

        events::emit_treasury_withdrawal(&e, &recipient, amount, &operation_id);
    }
}

#[contractimpl]
impl TokenInterface for SoroMintToken {
    fn allowance(e: Env, from: Address, spender: Address) -> i128 { Self::read_allowance(&e, &from, &spender) }
    fn approve(e: Env, from: Address, spender: Address, amount: i128, _exp: u32) {
        from.require_auth();
        if amount < 0 { panic!("approval amount must be non-negative"); }
        Self::write_allowance(&e, &from, &spender, amount);
        events::emit_approve(&e, &from, &spender, amount);
    }
    fn balance(e: Env, id: Address) -> i128 { Self::read_balance(&e, &id) }
    fn transfer(e: Env, from: Address, to: Address, amount: i128) {
        soromint_lifecycle::require_not_paused(&e);
        from.require_auth();
        if amount <= 0 { panic!("transfer amount must be positive"); }
        let (nf, nt) = Self::move_balance(&e, &from, &to, amount);
        events::emit_transfer(&e, &from, &to, amount, nf, nt);
    }
    fn transfer_from(e: Env, spender: Address, from: Address, to: Address, amount: i128) {
        soromint_lifecycle::require_not_paused(&e);
        spender.require_auth();
        if amount <= 0 { panic!("transfer amount must be positive"); }
        let al = Self::read_allowance(&e, &from, &spender);
        if al < amount { panic!("insufficient allowance"); }
        let (nf, nt) = Self::move_balance(&e, &from, &to, amount);
        Self::write_allowance(&e, &from, &spender, al - amount);
        events::emit_transfer_from(&e, &spender, &from, &to, amount, al - amount, nf, nt);
    }
    fn burn(e: Env, from: Address, amount: i128) {
        soromint_lifecycle::require_not_paused(&e);
        from.require_auth();
        if amount <= 0 { panic!("burn amount must be positive"); }
        let bal = Self::read_balance(&e, &from);
        if bal < amount { panic!("insufficient balance"); }
        Self::write_balance(&e, &from, bal - amount);
        let mut supply: i128 = e.storage().instance().get(&DataKey::Supply).unwrap_or(0);
        supply -= amount;
        e.storage().instance().set(&DataKey::Supply, &supply);
        let admin: Address = e.storage().instance().get(&DataKey::Admin).unwrap();
        events::emit_burn(&e, &admin, &from, amount, bal - amount, supply);
    }
    fn burn_from(e: Env, spender: Address, from: Address, amount: i128) {
        soromint_lifecycle::require_not_paused(&e);
        spender.require_auth();
        if amount <= 0 { panic!("burn amount must be positive"); }
        let al = Self::read_allowance(&e, &from, &spender);
        if al < amount { panic!("insufficient allowance"); }
        let bal = Self::read_balance(&e, &from);
        if bal < amount { panic!("insufficient balance"); }
        Self::write_allowance(&e, &from, &spender, al - amount);
        Self::write_balance(&e, &from, bal - amount);
        let mut supply: i128 = e.storage().instance().get(&DataKey::Supply).unwrap_or(0);
        supply -= amount;
        e.storage().instance().set(&DataKey::Supply, &supply);
        let admin: Address = e.storage().instance().get(&DataKey::Admin).unwrap();
        events::emit_burn(&e, &admin, &from, amount, bal - amount, supply);
    }

    fn decimals(e: Env) -> u32 { e.storage().instance().get(&DataKey::Decimals).unwrap_or(7) }
    fn name(e: Env) -> String { e.storage().instance().get(&DataKey::Name).unwrap_or_else(|| String::from_str(&e, "SoroMint")) }
    fn symbol(e: Env) -> String { e.storage().instance().get(&DataKey::Symbol).unwrap_or_else(|| String::from_str(&e, "SMT")) }
}
