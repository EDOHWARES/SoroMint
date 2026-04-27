//! # Streaming Payments Contract
//!
//! Enables continuous token payment streams that release funds per ledger.
//! Supports real-time payroll and subscription-based payment models.

#![no_std]

use soroban_sdk::{contract, contractimpl, contracttype, token, Address, Env, Map, Vec};

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Recipient {
    pub address: Address,
    pub weight: u32,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Stream {
    pub sender: Address,
    pub recipients: Vec<Recipient>,
    pub total_weight: u32,
    pub token: Address,
    pub rate_per_ledger: i128,
    pub start_ledger: u32,
    pub stop_ledger: u32,
    pub withdrawn: Map<Address, i128>,
}

#[contracttype]
pub enum DataKey {
    Stream(u64),
    NextStreamId,
    MaxAmount,
    Admin,
}

#[contract]
pub struct StreamingPayments;

#[contractimpl]
impl StreamingPayments {
    /// Initializes the streaming payments contract with an administrator.
    /// 
    /// # Arguments
    /// * `admin` - The address of the administrator.
    pub fn initialize(e: Env, admin: Address) {
        if e.storage().instance().has(&DataKey::Admin) {
            panic!("already initialized");
        }
        e.storage().instance().set(&DataKey::Admin, &admin);
    }

    /// Sets the maximum amount allowed per payment stream.
    /// 
    /// # Arguments
    /// * `amount` - The maximum total amount for a single stream.
    pub fn set_max_amount(e: Env, amount: i128) {
        let admin: Address = e
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .unwrap_or_else(|| panic!("not initialized"));
        admin.require_auth();
        e.storage().instance().set(&DataKey::MaxAmount, &amount);
    }

    /// Returns the maximum amount allowed per payment stream.
    pub fn get_max_amount(e: Env) -> i128 {
        e.storage()
            .instance()
            .get(&DataKey::MaxAmount)
            .unwrap_or(0)
    }

    /// Creates a new multi-recipient payment stream.
    /// 
    /// # Arguments
    /// * `sender` - The address of the account funding the stream.
    /// * `recipients` - A list of recipients and their proportional weights.
    /// * `token` - The address of the token being streamed.
    /// * `total_amount` - The total amount of tokens to be streamed over the duration.
    /// * `start_ledger` - The ledger sequence when the stream begins.
    /// * `stop_ledger` - The ledger sequence when the stream ends.
    /// 
    /// # Returns
    /// The unique ID of the created stream.
    pub fn create_stream(
        e: Env,
        sender: Address,
        recipients: Vec<Recipient>,
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
        
        let mut total_weight = 0u32;
        let mut withdrawn = Map::new(&e);
        for r in recipients.iter() {
            total_weight += r.weight;
            withdrawn.set(r.address.clone(), 0);
        }
        
        if total_weight == 0 { panic!("total weight must be positive"); }
        
        let stream = Stream {
            sender: sender.clone(),
            recipients: recipients.clone(),
            total_weight,
            token: token.clone(),
            rate_per_ledger,
            start_ledger,
            stop_ledger,
            withdrawn,
        };
        
        e.storage().persistent().set(&DataKey::Stream(stream_id), &stream);
        e.storage().instance().set(&DataKey::NextStreamId, &(stream_id + 1));
        
        e.events().publish(
            (soroban_sdk::symbol_short!("created"), stream_id),
            (sender, total_amount)
        );
        
        stream_id
    }
    
    /// Withdraws available funds for a recipient from a payment stream.
    /// 
    /// # Arguments
    /// * `recipient` - The address of the recipient withdrawing.
    /// * `stream_id` - The ID of the stream.
    /// * `amount` - The amount of tokens to withdraw.
    pub fn withdraw(e: Env, recipient: Address, stream_id: u64, amount: i128) {
        recipient.require_auth();
        
        let mut stream: Stream = e.storage().persistent()
            .get(&DataKey::Stream(stream_id))
            .unwrap_or_else(|| panic!("stream not found"));
        
        let available = Self::balance_of(e.clone(), stream_id, recipient.clone());
        if amount > available { panic!("insufficient balance"); }
        
        let current_withdrawn = stream.withdrawn.get(recipient.clone()).unwrap_or(0);
        stream.withdrawn.set(recipient.clone(), current_withdrawn + amount);
        e.storage().persistent().set(&DataKey::Stream(stream_id), &stream);
        
        let client = token::Client::new(&e, &stream.token);
        client.transfer(&e.current_contract_address(), &recipient, &amount);
        
        e.events().publish(
            (soroban_sdk::symbol_short!("withdraw"), stream_id),
            (recipient, amount)
        );
    }
    
    /// Cancels a payment stream and refunds remaining balances.
    /// 
    /// # Arguments
    /// * `stream_id` - The ID of the stream to cancel.
    pub fn cancel_stream(e: Env, stream_id: u64) {
        let stream: Stream = e.storage().persistent()
            .get(&DataKey::Stream(stream_id))
            .unwrap_or_else(|| panic!("stream not found"));
        
        stream.sender.require_auth();
        
        let client = token::Client::new(&e, &stream.token);
        let mut total_recipient_payout = 0i128;
        
        // Distribute available balances to all recipients
        for r in stream.recipients.iter() {
            let balance = Self::balance_of(e.clone(), stream_id, r.address.clone());
            if balance > 0 {
                client.transfer(&e.current_contract_address(), &r.address, &balance);
                total_recipient_payout += balance;
            }
        }
        
        // Calculate total deposited and refund unstreamed amount to sender
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
            (total_recipient_payout, refund)
        );
    }
    
    /// Returns the currently available balance of a stream for a specific recipient.
    pub fn balance_of(e: Env, stream_id: u64, recipient: Address) -> i128 {
        let stream: Stream = e.storage().persistent()
            .get(&DataKey::Stream(stream_id))
            .unwrap_or_else(|| panic!("stream not found"));
        
        let weight = stream.recipients.iter().find(|r| r.address == recipient)
            .map(|r| r.weight)
            .expect("recipient not in stream");
            
        let total_streamed = Self::calculate_streamed(&e, &stream);
        let recipient_share = (total_streamed * weight as i128) / stream.total_weight as i128;
        let recipient_withdrawn = stream.withdrawn.get(recipient).unwrap_or(0);
        
        recipient_share - recipient_withdrawn
    }
    
    /// Returns the full details of a payment stream.
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
        
        let mut recipients = Vec::new(&e);
        recipients.push_back(Recipient { address: recipient.clone(), weight: 1 });
        
        let stream_id = client.create_stream(&sender, &recipients, &token_addr, &1000, &100, &200);
        
        e.ledger().set_sequence_number(150);
        
        let balance = client.balance_of(&stream_id, &recipient);
        assert_eq!(balance, 500);
        
        client.withdraw(&recipient, &stream_id, &500);
        assert_eq!(token_client.balance(&recipient), 500);
    }

    #[test]
    fn test_multi_recipient_distribution() {
        let e = Env::default();
        e.mock_all_auths();
        
        let admin = Address::generate(&e);
        let sender = Address::generate(&e);
        let r1 = Address::generate(&e);
        let r2 = Address::generate(&e);
        
        let (token_addr, _token_client, token_admin) = create_token_contract(&e, &admin);
        token_admin.mint(&sender, &10000);
        
        let contract_id = e.register(StreamingPayments, ());
        let client = StreamingPaymentsClient::new(&e, &contract_id);
        client.initialize(&admin);
        
        let mut recipients = Vec::new(&e);
        recipients.push_back(Recipient { address: r1.clone(), weight: 3 }); // 30%
        recipients.push_back(Recipient { address: r2.clone(), weight: 7 }); // 70%
        
        e.ledger().set_sequence_number(100);
        let stream_id = client.create_stream(&sender, &recipients, &token_addr, &1000, &100, &200);
        
        e.ledger().set_sequence_number(200); // 100% streamed
        
        assert_eq!(client.balance_of(&stream_id, &r1), 300);
        assert_eq!(client.balance_of(&stream_id, &r2), 700);
        
        client.withdraw(&r1, &stream_id, &100);
        assert_eq!(client.balance_of(&stream_id, &r1), 200);
    }

    #[test]
    #[should_panic(expected = "amount exceeds global limit")]
    fn test_max_amount_limit() {
        let e = Env::default();
        e.mock_all_auths();
        
        let admin = Address::generate(&e);
        let sender = Address::generate(&e);
        let recipient = Address::generate(&e);
        
        let mut recipients = Vec::new(&e);
        recipients.push_back(Recipient { address: recipient.clone(), weight: 1 });
        
        client.initialize(&admin);
        client.set_max_amount(&500);
        
        e.ledger().set_sequence_number(100);
        // This should panic
        client.create_stream(&sender, &recipients, &token_addr, &1000, &100, &200);
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
    }
}
