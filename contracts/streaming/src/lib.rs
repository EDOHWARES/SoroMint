//! # Streaming Payments Contract
//!
//! Enables continuous token payment streams that release funds per ledger.
//! Supports real-time payroll and subscription-based payment models.

#![no_std]

use soroban_sdk::{contract, contractimpl, contracttype, token, Address, Env};

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Stream {
    pub sender: Address,
    pub recipient: Address,
    pub token: Address,
    pub rate_per_ledger: i128,
    pub start_ledger: u32,
    pub stop_ledger: u32,
    pub withdrawn: i128,
}

#[contracttype]
pub enum DataKey {
    Admin,
    Treasury,
    FeeBasisPoints,
    Stream(u64),
    NextStreamId,
}

#[contract]
pub struct StreamingPayments;

#[contractimpl]
impl StreamingPayments {
    /// Initialize the contract with an admin address
    pub fn initialize(e: Env, admin: Address) {
        if e.storage().instance().has(&DataKey::Admin) {
            panic!("already initialized");
        }
        e.storage().instance().set(&DataKey::Admin, &admin);
        e.storage().instance().set(&DataKey::NextStreamId, &0u64);
        // Default fee 0, treasury optional; not set here
    }

    /// Set the treasury address (admin only)
    pub fn set_treasury(e: Env, treasury: Address) {
        let admin: Address = e.storage().instance().get(&DataKey::Admin).unwrap();
        admin.require_auth();
        e.storage().instance().set(&DataKey::Treasury, &treasury);
        e.events().publish(
            (soroban_sdk::symbol_short!("trsry_set"),),
            (treasury,)
        );
    }

    /// Get treasury address
    pub fn get_treasury(e: Env) -> Address {
        e.storage().instance().get(&DataKey::Treasury).unwrap()
    }

    /// Set fee basis points (admin only). 10000 = 100%
    pub fn set_fee_basis_points(e: Env, fee_bp: u32) {
        let admin: Address = e.storage().instance().get(&DataKey::Admin).unwrap();
        admin.require_auth();
        if fee_bp > 10000 {
            panic!("fee basis points cannot exceed 10000");
        }
        e.storage().instance().set(&DataKey::FeeBasisPoints, &fee_bp);
        e.events().publish(
            (soroban_sdk::symbol_short!("feebp_set"),),
            (fee_bp,)
        );
    }

    /// Get fee basis points
    pub fn get_fee_basis_points(e: Env) -> u32 {
        e.storage().instance().get(&DataKey::FeeBasisPoints).unwrap_or(0)
    }

    /// Create a new payment stream
    pub fn create_stream(
        e: Env,
        sender: Address,
        recipient: Address,
        token: Address,
        total_amount: i128,
        start_ledger: u32,
        stop_ledger: u32,
    ) -> u64 {
        sender.require_auth();
        
        if total_amount <= 0 { panic!("amount must be positive"); }
        if stop_ledger <= start_ledger { panic!("invalid ledger range"); }
        
        let duration = (stop_ledger - start_ledger) as i128;
        let rate_per_ledger = total_amount / duration;
        
        if rate_per_ledger == 0 { panic!("amount too small for duration"); }
        
        // Transfer tokens to contract
        let client = token::Client::new(&e, &token);
        client.transfer(&sender, &e.current_contract_address(), &total_amount);
        
        let stream_id = e.storage().instance().get(&DataKey::NextStreamId).unwrap_or(0u64);
        
        let stream = Stream {
            sender: sender.clone(),
            recipient: recipient.clone(),
            token: token.clone(),
            rate_per_ledger,
            start_ledger,
            stop_ledger,
            withdrawn: 0,
        };
        
        e.storage().persistent().set(&DataKey::Stream(stream_id), &stream);
        e.storage().instance().set(&DataKey::NextStreamId, &(stream_id + 1));
        
        e.events().publish(
            (soroban_sdk::symbol_short!("created"), stream_id),
            (sender, recipient, total_amount)
        );
        
        stream_id
    }
    
    /// Withdraw available funds from a stream
    pub fn withdraw(e: Env, stream_id: u64, amount: i128) {
        let mut stream: Stream = e.storage().persistent()
            .get(&DataKey::Stream(stream_id))
            .unwrap_or_else(|| panic!("stream not found"));

        stream.recipient.require_auth();

        let available = Self::balance_of(e.clone(), stream_id);
        if amount > available { panic!("insufficient balance"); }

        // Calculate fee
        let fee_bp: u32 = e.storage().instance().get(&DataKey::FeeBasisPoints).unwrap_or(0);
        let fee_amount = if fee_bp > 0 {
            (amount * (fee_bp as i128)) / 10000
        } else {
            0
        };
        let net_amount = amount - fee_amount;

        // Update withdrawn with gross amount
        stream.withdrawn += amount;
        e.storage().persistent().set(&DataKey::Stream(stream_id), &stream);

        let client = token::Client::new(&e, &stream.token);

        // Transfer net to recipient
        if net_amount > 0 {
            client.transfer(&e.current_contract_address(), &stream.recipient, &net_amount);
        }

        // Transfer fee to treasury if applicable
        if fee_amount > 0 {
            let treasury: Address = e.storage().instance().get(&DataKey::Treasury)
                .unwrap_or_else(|| panic!("treasury not set for fee collection"));
            client.transfer(&e.current_contract_address(), &treasury, &fee_amount);
        }

        e.events().publish(
            (soroban_sdk::symbol_short!("withdraw"), stream_id),
            (stream.recipient.clone(), amount, fee_amount)
        );
    }

    /// Cancel a stream and refund remaining balance
    pub fn cancel_stream(e: Env, stream_id: u64) {
        let stream: Stream = e.storage().persistent()
            .get(&DataKey::Stream(stream_id))
            .unwrap_or_else(|| panic!("stream not found"));
        
        stream.sender.require_auth();
        
        let recipient_balance = Self::balance_of(e.clone(), stream_id);
        let client = token::Client::new(&e, &stream.token);
        
        // Transfer available balance to recipient
        if recipient_balance > 0 {
            client.transfer(&e.current_contract_address(), &stream.recipient, &recipient_balance);
        }
        
        // Calculate total deposited and refund unstreamed amount
        let duration = (stream.stop_ledger - stream.start_ledger) as i128;
        let total_deposited = stream.rate_per_ledger * duration;
        let total_streamed = Self::calculate_streamed(&e, &stream);
        let refund = total_deposited - total_streamed;
        
        if refund > 0 {
            client.transfer(&e.current_contract_address(), &stream.sender, &refund);
        }
        
        e.storage().persistent().remove(&DataKey::Stream(stream_id));
        
        e.events().publish(
            (soroban_sdk::symbol_short!("canceled"), stream_id),
            (recipient_balance, refund)
        );
    }
    
    /// Get available balance for withdrawal
    pub fn balance_of(e: Env, stream_id: u64) -> i128 {
        let stream: Stream = e.storage().persistent()
            .get(&DataKey::Stream(stream_id))
            .unwrap_or_else(|| panic!("stream not found"));
        
        let streamed = Self::calculate_streamed(&e, &stream);
        streamed - stream.withdrawn
    }
    
    /// Get stream details
    pub fn get_stream(e: Env, stream_id: u64) -> Stream {
        e.storage().persistent()
            .get(&DataKey::Stream(stream_id))
            .unwrap_or_else(|| panic!("stream not found"))
    }
    
    fn calculate_streamed(e: &Env, stream: &Stream) -> i128 {
        let current = e.ledger().sequence();
        
        if current <= stream.start_ledger {
            return 0;
        }
        
        let elapsed = if current >= stream.stop_ledger {
            stream.stop_ledger - stream.start_ledger
        } else {
            current - stream.start_ledger
        };
        
        stream.rate_per_ledger * (elapsed as i128)
    }
}

#[cfg(test)]
mod test {
    use super::*;
    use soroban_sdk::{testutils::{Address as _, Ledger}, token, Address, Env};

    fn create_token_contract<'a>(e: &Env, admin: &Address) -> (Address, token::Client<'a>, token::StellarAssetClient<'a>) {
        let contract = e.register_stellar_asset_contract_v2(admin.clone());
        let addr = contract.address();
        (addr.clone(), token::Client::new(e, &addr), token::StellarAssetClient::new(e, &addr))
    }

    #[test]
    fn test_create_and_withdraw() {
        let e = Env::default();
        e.mock_all_auths();
        
        let admin = Address::generate(&e);
        let sender = Address::generate(&e);
        let recipient = Address::generate(&e);
        
        let (token_addr, token_client, token_admin) = create_token_contract(&e, &admin);
        token_admin.mint(&sender, &10000);
        
        let contract_id = e.register(StreamingPayments, ());
        let client = StreamingPaymentsClient::new(&e, &contract_id);
        
        e.ledger().set_sequence_number(100);
        
        let stream_id = client.create_stream(&sender, &recipient, &token_addr, &1000, &100, &200);
        
        e.ledger().set_sequence_number(150);
        
        let balance = client.balance_of(&stream_id);
        assert_eq!(balance, 500);
        
        client.withdraw(&stream_id, &500);
        assert_eq!(token_client.balance(&recipient), 500);
    }

    #[test]
    fn test_cancel_stream() {
        let e = Env::default();
        e.mock_all_auths();
        
        let admin = Address::generate(&e);
        let sender = Address::generate(&e);
        let recipient = Address::generate(&e);
        
        let (token_addr, token_client, token_admin) = create_token_contract(&e, &admin);
        token_admin.mint(&sender, &10000);
        
        let contract_id = e.register(StreamingPayments, ());
        let client = StreamingPaymentsClient::new(&e, &contract_id);
        
        e.ledger().set_sequence_number(100);
        let stream_id = client.create_stream(&sender, &recipient, &token_addr, &1000, &100, &200);
        
        e.ledger().set_sequence_number(150);
        client.cancel_stream(&stream_id);
        
        assert_eq!(token_client.balance(&recipient), 500);
        assert_eq!(token_client.balance(&sender), 9500);
    }

    #[test]
    fn test_fee_collection() {
        let e = Env::default();
        e.mock_all_auths();

        let admin = Address::generate(&e);
        let sender = Address::generate(&e);
        let recipient = Address::generate(&e);
        let treasury = Address::generate(&e);

        let (token_addr, token_client, token_admin) = create_token_contract(&e, &admin);
        token_admin.mint(&sender, &10000);

        let contract_id = e.register(StreamingPayments, ());
        let client = StreamingPaymentsClient::new(&e, &contract_id);

        // Initialize admin and set treasury + fee (10% = 1000 bp)
        client.initialize(&admin);
        client.set_treasury(&treasury);
        client.set_fee_basis_points(&1000); // 10%

        e.ledger().set_sequence_number(100);
        let stream_id = client.create_stream(&sender, &recipient, &token_addr, &1000, &100, &200);

        e.ledger().set_sequence_number(150);
        // Withdraw 500; with 10% fee => 50 fee, net 450
        client.withdraw(&stream_id, &500);

        assert_eq!(token_client.balance(&recipient), 450);
        assert_eq!(token_client.balance(&treasury), 50);
        assert_eq!(token_client.balance(&sender), 9000); // after deposit transfer
    }

    #[test]
    fn test_no_fee_by_default() {
        let e = Env::default();
        e.mock_all_auths();

        let admin = Address::generate(&e);
        let sender = Address::generate(&e);
        let recipient = Address::generate(&e);

        let (token_addr, token_client, token_admin) = create_token_contract(&e, &admin);
        token_admin.mint(&sender, &10000);

        let contract_id = e.register(StreamingPayments, ());
        let client = StreamingPaymentsClient::new(&e, &contract_id);

        // Initialize without setting fee (default 0)
        client.initialize(&admin);

        e.ledger().set_sequence_number(100);
        let stream_id = client.create_stream(&sender, &recipient, &token_addr, &1000, &100, &200);

        e.ledger().set_sequence_number(150);
        client.withdraw(&stream_id, &500);

        assert_eq!(token_client.balance(&recipient), 500);
    }
}
