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
    pub total_deposited: i128,
    pub base_streamed: i128,
}

#[contracttype]
pub enum DataKey {
    Stream(u64),
    NextStreamId,
}

#[contract]
pub struct StreamingPayments;

#[contractimpl]
impl StreamingPayments {
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
            total_deposited: total_amount,
            base_streamed: 0,
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
        
        // Refund unstreamed amount using stored total_deposited
        let total_streamed = Self::calculate_streamed(&e, &stream);
        let refund = stream.total_deposited - total_streamed;
        
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
            return stream.base_streamed;
        }
        
        let elapsed = if current >= stream.stop_ledger {
            stream.stop_ledger - stream.start_ledger
        } else {
            current - stream.start_ledger
        };
        
        stream.base_streamed + stream.rate_per_ledger * (elapsed as i128)
    }

    /// Adjust stream rate and/or end time.
    /// Can be called by both sender and recipient together, or by a governance/DAO address.
    /// At least one of new_rate_per_ledger or new_stop_ledger must be provided.
    /// If only one is provided, the other is recalculated from remaining balance.
    /// If both provided, they must satisfy: remaining_balance = new_rate * remaining_ledgers
    pub fn adjust_stream(
        e: Env,
        stream_id: u64,
        new_rate_per_ledger: Option<i128>,
        new_stop_ledger: Option<u32>,
        governance: Option<Address>
    ) {
        let mut stream: Stream = e.storage().persistent()
            .get(&DataKey::Stream(stream_id))
            .unwrap_or_else(|| panic!("stream not found"));

        let current_ledger = e.ledger().sequence();

        // Stream must be active
        if current_ledger > stream.stop_ledger {
            panic!("stream has already ended");
        }

        // Authorization
        if let Some(gov) = governance {
            gov.require_auth();
        } else {
            stream.sender.require_auth();
            stream.recipient.require_auth();
        }

        // Compute amount streamed up to current ledger using the old parameters
        let old_streamed_since_start = if current_ledger > stream.start_ledger {
            let elapsed = (current_ledger - stream.start_ledger) as i128;
            stream.rate_per_ledger * elapsed
        } else {
            0
        };

        // Update base_streamed to include what has been streamed so far
        let new_base = stream.base_streamed + old_streamed_since_start;

        // Remaining tokens available for future streaming
        let remaining_balance = stream.total_deposited - new_base - stream.withdrawn;
        if remaining_balance <= 0 {
            panic!("no remaining balance to adjust");
        }

        // Determine new rate and stop ledger
        let (new_rate, new_stop) = match (new_rate_per_ledger, new_stop_ledger) {
            (Some(rate), Some(stop)) => {
                if rate <= 0 {
                    panic!("rate must be positive");
                }
                if stop <= current_ledger || stop <= stream.start_ledger {
                    panic!("invalid stop ledger");
                }
                let remaining_ledgers = (stop - current_ledger) as i128;
                if rate * remaining_ledgers != remaining_balance {
                    panic!("rate and stop ledger do not match remaining balance");
                }
                (rate, stop)
            }
            (Some(rate), None) => {
                if rate <= 0 {
                    panic!("rate must be positive");
                }
                if remaining_balance % rate != 0 {
                    panic!("remaining balance not evenly divisible by new rate");
                }
                let remaining_ledgers = remaining_balance / rate;
                let stop = current_ledger + remaining_ledgers as u32;
                if stop <= current_ledger {
                    panic!("calculated stop ledger too short");
                }
                (rate, stop)
            }
            (None, Some(stop)) => {
                if stop <= current_ledger || stop <= stream.start_ledger {
                    panic!("invalid stop ledger");
                }
                let remaining_ledgers = (stop - current_ledger) as i128;
                if remaining_balance % remaining_ledgers != 0 {
                    panic!("remaining balance not evenly divisible by remaining ledgers");
                }
                let rate = remaining_balance / remaining_ledgers;
                if rate <= 0 {
                    panic!("resulting rate would be too small");
                }
                (rate, stop)
            }
            (None, None) => {
                panic!("must provide at least one of new_rate_per_ledger or new_stop_ledger");
            }
        };

        // Apply the adjustment: reset base and set new parameters
        stream.base_streamed = new_base;
        stream.start_ledger = current_ledger;
        stream.rate_per_ledger = new_rate;
        stream.stop_ledger = new_stop;

        e.storage().persistent().set(&DataKey::Stream(stream_id), &stream);

        e.events().publish(
            (soroban_sdk::symbol_short!("adjusted"), stream_id),
            (new_rate, new_stop)
        );
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
    fn test_adjust_stream_rate_only() {
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
        // Stream: 1000 tokens from ledger 100 to 200 = rate 10 per ledger
        let stream_id = client.create_stream(&sender, &recipient, &token_addr, &1000, &100, &200);

        // Advance to ledger 150 - 50 ledgers elapsed, 500 streamed, 500 remaining
        e.ledger().set_sequence_number(150);

        // Adjust rate to 20 per ledger. Remaining 500 tokens => 25 more ledgers needed
        // New stop = 150 + 25 = 175
        client.adjust_stream(&stream_id, &Some(20), &None, &None);

        let stream = client.get_stream(&stream_id);
        assert_eq!(stream.rate_per_ledger, 20);
        assert_eq!(stream.stop_ledger, 175);

        // Verify balance calculation works with new rate
        let balance = client.balance_of(&stream_id);
        assert_eq!(balance, 500); // Still 500 remaining
    }

    #[test]
    fn test_adjust_stream_stop_only() {
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
        // Stream: 1000 tokens from ledger 100 to 200 = rate 10 per ledger
        let stream_id = client.create_stream(&sender, &recipient, &token_addr, &1000, &100, &200);

        // Advance to ledger 150
        e.ledger().set_sequence_number(150);

        // Extend to ledger 250. Remaining ledgers = 100, rate = 500/100 = 5
        client.adjust_stream(&stream_id, &None, &Some(250), &None);

        let stream = client.get_stream(&stream_id);
        assert_eq!(stream.rate_per_ledger, 5);
        assert_eq!(stream.stop_ledger, 250);
    }

    #[test]
    fn test_adjust_stream_both_params() {
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

        // Set rate to 25 and stop to 170: remaining ledgers = 20, balance = 25*20 = 500 ✓
        client.adjust_stream(&stream_id, &Some(25), &Some(170), &None);

        let stream = client.get_stream(&stream_id);
        assert_eq!(stream.rate_per_ledger, 25);
        assert_eq!(stream.stop_ledger, 170);
    }

    #[test]
    #[should_panic]
    fn test_adjust_stream_unauthorized() {
        let e = Env::default();
        // No mock_all_auths - manually authorize only sender for create

        let admin = Address::generate(&e);
        let sender = Address::generate(&e);
        let recipient = Address::generate(&e);
        let _stranger = Address::generate(&e);

        let (token_addr, _, token_admin) = create_token_contract(&e, &admin);
        token_admin.mint(&sender, &10000);

        let contract_id = e.register(StreamingPayments, ());
        let client = StreamingPaymentsClient::new(&e, &contract_id);

        // Create stream with sender auth
        sender.require_auth();
        e.ledger().set_sequence_number(100);
        let stream_id = client.create_stream(&sender, &recipient, &token_addr, &1000, &100, &200);

        // Attempt adjust without both parties' auth (stranger calls, no auth)
        let stranger_client = StreamingPaymentsClient::new(&e, &contract_id);
        stranger_client.adjust_stream(&stream_id, &Some(5), &None, &None);
    }

    #[test]
    fn test_adjust_stream_governance_override() {
        let e = Env::default();
        e.mock_all_auths();

        let admin = Address::generate(&e);
        let sender = Address::generate(&e);
        let recipient = Address::generate(&e);
        let governance = Address::generate(&e);

        let (token_addr, _, token_admin) = create_token_contract(&e, &admin);
        token_admin.mint(&sender, &10000);

        let contract_id = e.register(StreamingPayments, ());
        let client = StreamingPaymentsClient::new(&e, &contract_id);

        e.ledger().set_sequence_number(100);
        let stream_id = client.create_stream(&sender, &recipient, &token_addr, &1000, &100, &200);

        e.ledger().set_sequence_number(150);

        // Governance adjusts without needing both parties
        let gov_client = StreamingPaymentsClient::new(&e, &contract_id);
        gov_client.adjust_stream(&stream_id, &Some(25), &Some(170), &Some(governance));

        let stream = client.get_stream(&stream_id);
        assert_eq!(stream.rate_per_ledger, 25);
        assert_eq!(stream.stop_ledger, 170);
    }
}
