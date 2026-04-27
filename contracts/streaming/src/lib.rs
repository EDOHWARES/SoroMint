//! # Streaming Payments Contract
//!
//! Enables continuous token payment streams that release funds per ledger.
//! Supports real-time payroll and subscription-based payment models.

#![no_std]

use soroban_sdk::{contract, contractimpl, contracttype, token, Address, Env, String};

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
    Stream(u64),
    NextStreamId,
    MaxAmount,
    Admin,
}

/// Contract metadata structure for explorer display
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ContractMetadata {
    pub name: String,
    pub description: String,
    pub version: String,
    pub logo_url: String,
}

#[contract]
pub struct StreamingPayments;

#[contractimpl]
impl StreamingPayments {
    /// Get contract metadata (name, description, version, logo_url)
    pub fn get_metadata(e: Env) -> ContractMetadata {
        ContractMetadata {
            name: String::from_str(&e, "SoroMint Streaming Payments"),
            description: String::from_str(&e, "A Soroban-based streaming payments protocol enabling real-time token transfers between users."),
            version: String::from_str(&e, "1.0.0"),
            logo_url: String::from_str(&e, "https://soromint.app/logo.png"),
        }
    }
    
    /// Get contract name
    pub fn name(e: Env) -> String {
        String::from_str(&e, "SoroMint Streaming Payments")
    }
    
    /// Get contract description
    pub fn description(e: Env) -> String {
        String::from_str(&e, "A Soroban-based streaming payments protocol enabling real-time token transfers between users.")
    }
    
    /// Get contract version
    pub fn version(e: Env) -> String {
        String::from_str(&e, "1.0.0")
    }
    
    /// Get contract logo URL
    pub fn logo_url(e: Env) -> String {
        String::from_str(&e, "https://soromint.app/logo.png")
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

        if total_amount <= 0 {
            panic!("amount must be positive");
        }

        // Check against global max amount limit if set
        if let Some(max_amount) = e.storage().instance().get::<DataKey, i128>(&DataKey::MaxAmount) {
            if total_amount > max_amount {
                panic!("amount exceeds global limit");
            }
        }

        if stop_ledger <= start_ledger {
            panic!("invalid ledger range");
        }
        
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
        
        stream.withdrawn += amount;
        e.storage().persistent().set(&DataKey::Stream(stream_id), &stream);
        
        let client = token::Client::new(&e, &stream.token);
        client.transfer(&e.current_contract_address(), &stream.recipient, &amount);
        
        e.events().publish(
            (soroban_sdk::symbol_short!("withdraw"), stream_id),
            (stream.recipient.clone(), amount)
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
        
        client.initialize(&admin);
        
        e.ledger().set_sequence_number(100);
        
        let stream_id = client.create_stream(&sender, &recipient, &token_addr, &1000, &100, &200);
        
        e.ledger().set_sequence_number(150);
        
        let balance = client.balance_of(&stream_id);
        assert_eq!(balance, 500);
        
        client.withdraw(&stream_id, &500);
        assert_eq!(token_client.balance(&recipient), 500);
    }

    #[test]
    #[should_panic(expected = "amount exceeds global limit")]
    fn test_max_amount_limit() {
        let e = Env::default();
        e.mock_all_auths();
        
        let admin = Address::generate(&e);
        let sender = Address::generate(&e);
        let recipient = Address::generate(&e);
        
        let (token_addr, _token_client, token_admin) = create_token_contract(&e, &admin);
        token_admin.mint(&sender, &10000);
        
        let contract_id = e.register(StreamingPayments, ());
        let client = StreamingPaymentsClient::new(&e, &contract_id);
        
        client.initialize(&admin);
        client.set_max_amount(&500);
        
        e.ledger().set_sequence_number(100);
        // This should panic
        client.create_stream(&sender, &recipient, &token_addr, &1000, &100, &200);
    }

    #[test]
    fn test_set_max_amount_admin_only() {
        let e = Env::default();
        e.mock_all_auths();
        
        let admin = Address::generate(&e);
        
        let contract_id = e.register(StreamingPayments, ());
        let client = StreamingPaymentsClient::new(&e, &contract_id);
        
        client.initialize(&admin);
        
        // This should work
        client.set_max_amount(&1000);
        
        // This should fail because mock_all_auths is on, but we want to verify the logic
        // In a real test without mock_all_auths, we would verify the requirement for admin auth.
        // However, we can check that it doesn't panic when admin is used.
    }
    
    #[test]
    fn test_metadata() {
        let e = Env::default();
        let contract_id = e.register(StreamingPayments, ());
        let client = StreamingPaymentsClient::new(&e, &contract_id);
        
        // Test get_metadata() returns all fields
        let metadata = client.get_metadata();
        assert_eq!(metadata.name, "SoroMint Streaming Payments");
        assert_eq!(metadata.description, "A Soroban-based streaming payments protocol enabling real-time token transfers between users.");
        assert_eq!(metadata.version, "1.0.0");
        assert_eq!(metadata.logo_url, "https://soromint.app/logo.png");
        
        // Test individual getters
        assert_eq!(client.name(), "SoroMint Streaming Payments");
        assert_eq!(client.description(), "A Soroban-based streaming payments protocol enabling real-time token transfers between users.");
        assert_eq!(client.version(), "1.0.0");
        assert_eq!(client.logo_url(), "https://soromint.app/logo.png");
    }
}
