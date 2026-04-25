//! # Streaming Payments Contract
//!
//! Enables continuous token payment streams that release funds per ledger.
//! Supports real-time payroll and subscription-based payment models.

#![no_std]

use soroban_sdk::{contract, contractimpl, contracttype, token, Address, Env, Symbol, IntoVal};

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
    // Stable stream fields
    pub is_stable: bool,
    pub usd_per_ledger: i128,
    pub usd_withdrawn: i128,
}

#[contracttype]
pub enum DataKey {
    Admin,
    Oracle,
    Stream(u64),
    NextStreamId,
}

#[contract]
pub struct StreamingPayments;

#[contractimpl]
impl StreamingPayments {
    /// Initialize the contract with admin address and oracle address
    pub fn initialize(e: Env, admin: Address, oracle: Address) {
        if e.storage().instance().has(&DataKey::Admin) {
            panic!("already initialized");
        }
        e.storage().instance().set(&DataKey::Admin, &admin);
        e.storage().instance().set(&DataKey::Oracle, &oracle);
        e.storage().instance().set(&DataKey::NextStreamId, &0u64);
    }

    /// Update oracle address (admin only)
    pub fn set_oracle(e: Env, new_oracle: Address) {
        let admin: Address = e.storage().instance().get(&DataKey::Admin).unwrap();
        admin.require_auth();
        e.storage().instance().set(&DataKey::Oracle, &new_oracle);
        e.events().publish(
            (soroban_sdk::symbol_short!("orcl_set"),),
            (new_oracle,)
        );
    }

    /// Get current oracle address
    pub fn get_oracle(e: Env) -> Address {
        e.storage().instance().get(&DataKey::Oracle).unwrap()
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
            total_deposited: total_amount,
            is_stable: false,
            usd_per_ledger: 0,
            usd_withdrawn: 0,
        };
        
        e.storage().persistent().set(&DataKey::Stream(stream_id), &stream);
        e.storage().instance().set(&DataKey::NextStreamId, &(stream_id + 1));
        
        e.events().publish(
            (soroban_sdk::symbol_short!("created"), stream_id),
            (sender, recipient, total_amount)
        );
        
        stream_id
    }

    /// Create a stable-value stream where recipient receives a fixed USD value per ledger.
    /// The sender deposits a total amount of tokens; the actual token amount streamed per ledger
    /// is determined by querying the price oracle at withdrawal time.
    pub fn create_stable_stream(
        e: Env,
        sender: Address,
        recipient: Address,
        token: Address,
        total_token_amount: i128,
        usd_per_ledger: i128,
        start_ledger: u32,
        stop_ledger: u32,
    ) -> u64 {
        sender.require_auth();

        if total_token_amount <= 0 { panic!("amount must be positive"); }
        if usd_per_ledger <= 0 { panic!("usd_per_ledger must be positive"); }
        if stop_ledger <= start_ledger { panic!("invalid ledger range"); }

        // Transfer tokens to contract
        let token_client = token::Client::new(&e, &token);
        token_client.transfer(&sender, &e.current_contract_address(), &total_token_amount);

        let stream_id = e.storage().instance().get(&DataKey::NextStreamId).unwrap_or(0u64);

        let stream = Stream {
            sender: sender.clone(),
            recipient: recipient.clone(),
            token: token.clone(),
            rate_per_ledger: 0, // not used for stable
            start_ledger,
            stop_ledger,
            withdrawn: 0,
            total_deposited: total_token_amount,
            is_stable: true,
            usd_per_ledger,
            usd_withdrawn: 0,
        };

        e.storage().persistent().set(&DataKey::Stream(stream_id), &stream);
        e.storage().instance().set(&DataKey::NextStreamId, &(stream_id + 1));

        e.events().publish(
            (soroban_sdk::symbol_short!("stbl_crtd"), stream_id),
            (sender, recipient, total_token_amount, usd_per_ledger)
        );

        stream_id
    }

    /// Withdraw available funds from a stream
    pub fn withdraw(e: Env, stream_id: u64, amount: i128) {
        let mut stream: Stream = e.storage().persistent()
            .get(&DataKey::Stream(stream_id))
            .unwrap_or_else(|| panic!("stream not found"));

        if stream.is_stable {
            panic!("stable streams require withdraw_stable");
        }

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

    /// Withdraw available funds from a stable stream.
    /// Converts accrued USD value to tokens using the current oracle price.
    pub fn withdraw_stable(e: Env, stream_id: u64) {
        let mut stream: Stream = e.storage().persistent()
            .get(&DataKey::Stream(stream_id))
            .unwrap_or_else(|| panic!("stream not found"));

        if !stream.is_stable {
            panic!("not a stable stream");
        }

        stream.recipient.require_auth();

        let current = e.ledger().sequence();

        // Elapsed ledgers
        let elapsed = if current <= stream.start_ledger {
            0i128
        } else if current >= stream.stop_ledger {
            (stream.stop_ledger - stream.start_ledger) as i128
        } else {
            (current - stream.start_ledger) as i128
        };
        let accrued_usd = stream.usd_per_ledger * elapsed;
        let remaining_usd = accrued_usd - stream.usd_withdrawn;
        if remaining_usd <= 0 {
            panic!("no stable balance available");
        }

        // Price from oracle (7 decimals)
        let oracle_addr: Address = e.storage().instance().get(&DataKey::Oracle)
            .unwrap_or_else(|| panic!("oracle not set"));
        let price = Self::get_price(&e, &oracle_addr, &stream.token);

        // Token decimals
        let token_client = token::Client::new(&e, &stream.token);
        let token_decimals = token_client.decimals();

        // Convert remaining_usd to token amount
        let mut token_amount = remaining_usd
            .checked_mul(10i128.pow(token_decimals))
            .expect("overflow converting USD to tokens")
            .checked_div(price)
            .expect("division error in conversion");

        // Cap by remaining tokens deposit
        let remaining_tokens = stream.total_deposited - stream.withdrawn;
        if token_amount > remaining_tokens {
            token_amount = remaining_tokens;
        }

        // Update withdrawn token amount (gross)
        stream.withdrawn += token_amount;

        // Update usd_withdrawn: compute USD value of tokens actually transferred
        let actual_usd = token_amount
            .checked_mul(price)
            .expect("overflow")
            .checked_div(10i128.pow(token_decimals))
            .expect("division error");
        stream.usd_withdrawn += actual_usd;

        e.storage().persistent().set(&DataKey::Stream(stream_id), &stream);

        // Transfer tokens to recipient
        token_client.transfer(&e.current_contract_address(), &stream.recipient, &token_amount);

        e.events().publish(
            (soroban_sdk::symbol_short!("stbl_wdr"), stream_id),
            (token_amount, actual_usd)
        );
    }

    /// Cancel a stream and refund remaining balance
    pub fn cancel_stream(e: Env, stream_id: u64) {
        let mut stream: Stream = e.storage().persistent()
            .get(&DataKey::Stream(stream_id))
            .unwrap_or_else(|| panic!("stream not found"));

        stream.sender.require_auth();

        let client = token::Client::new(&e, &stream.token);

        if stream.is_stable {
            // Stable stream: compute accrued tokens and refund remainder
            let current = e.ledger().sequence();
            let elapsed = if current <= stream.start_ledger {
                0i128
            } else if current >= stream.stop_ledger {
                (stream.stop_ledger - stream.start_ledger) as i128
            } else {
                (current - stream.start_ledger) as i128
            };
            let accrued_usd = stream.usd_per_ledger * elapsed;

            // Get price and decimals
            let oracle_addr: Address = e.storage().instance().get(&DataKey::Oracle)
                .unwrap_or_else(|| panic!("oracle not set"));
            let price = Self::get_price(&e, &oracle_addr, &stream.token);
            let token_client = token::Client::new(&e, &stream.token);
            let token_decimals = token_client.decimals();

            // Convert accrued USD to tokens
            let accrued_tokens = accrued_usd
                .checked_mul(10i128.pow(token_decimals))
                .expect("overflow")
                .checked_div(price)
                .expect("division error");

            // Amount to give recipient = accrued_tokens - already withdrawn tokens
            let recipient_amount = if accrued_tokens > stream.withdrawn {
                accrued_tokens - stream.withdrawn
            } else {
                0
            };
            if recipient_amount > 0 {
                client.transfer(&e.current_contract_address(), &stream.recipient, &recipient_amount);
            }

            // Refund remaining tokens to sender
            let refund = stream.total_deposited - stream.withdrawn - recipient_amount;
            if refund > 0 {
                client.transfer(&e.current_contract_address(), &stream.sender, &refund);
            }

            e.storage().persistent().remove(&DataKey::Stream(stream_id));
            e.events().publish(
                (soroban_sdk::symbol_short!("stbl_cncl"), stream_id),
                (recipient_amount, refund)
            );
        } else {
            // Regular stream logic
            let recipient_balance = Self::balance_of(e.clone(), stream_id);
            if recipient_balance > 0 {
                client.transfer(&e.current_contract_address(), &stream.recipient, &recipient_balance);
            }
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
    }
    
    /// Get available balance for withdrawal (in token amount)
    pub fn balance_of(e: Env, stream_id: u64) -> i128 {
        let stream: Stream = e.storage().persistent()
            .get(&DataKey::Stream(stream_id))
            .unwrap_or_else(|| panic!("stream not found"));

        if stream.is_stable {
            // Calculate accrued USD
            let current = e.ledger().sequence();
            let elapsed = if current <= stream.start_ledger {
                0i128
            } else if current >= stream.stop_ledger {
                (stream.stop_ledger - stream.start_ledger) as i128
            } else {
                (current - stream.start_ledger) as i128
            };
            let accrued_usd = stream.usd_per_ledger * elapsed;
            let remaining_usd = accrued_usd - stream.usd_withdrawn;
            if remaining_usd <= 0 {
                return 0;
            }

            // Get token price from oracle (price with 7 decimals)
            let oracle_addr: Address = e.storage().instance().get(&DataKey::Oracle)
                .unwrap_or_else(|| panic!("oracle not set"));
            let price = Self::get_price(&e, &oracle_addr, &stream.token);

            // Get token decimals
            let token_client = token::Client::new(&e, &stream.token);
            let token_decimals = token_client.decimals();

            // Convert USD to tokens: token_amount = (usd * 10^token_decimals) / price
            let mut token_amount = remaining_usd
                .checked_mul(10i128.pow(token_decimals))
                .expect("overflow converting USD to tokens")
                .checked_div(price)
                .expect("division error in conversion");

            // Cap by remaining tokens in contract (total_deposited - withdrawn)
            let remaining_tokens = stream.total_deposited - stream.withdrawn;
            if token_amount > remaining_tokens {
                token_amount = remaining_tokens;
            }

            token_amount
        } else {
            let streamed = Self::calculate_streamed(&e, &stream);
            streamed - stream.withdrawn
        }
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

    /// Helper to fetch token price (7 decimals) from oracle
    fn get_price(e: &Env, oracle: &Address, token: &Address) -> i128 {
        let args = soroban_sdk::vec![e, token.clone().into_val(e)];
        e.invoke_contract::<i128>(oracle, &Symbol::new(e, "get_price"), args)
    }
}

#[cfg(test)]
mod test {
    use super::*;
    use soroban_sdk::{testutils::{Address as _, Ledger}, token, Address, Env};
    use soromint_oracle::{PriceOracle, PriceOracleClient};

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
    fn test_stable_stream() {
        let e = Env::default();
        e.mock_all_auths();

        let admin = Address::generate(&e);
        let sender = Address::generate(&e);
        let recipient = Address::generate(&e);

        // Create a token
        let (token_addr, token_client, token_admin) = create_token_contract(&e, &admin);
        token_admin.mint(&sender, &10000);

        // Create and initialize oracle
        let oracle_contract_id = e.register(PriceOracle, ());
        let oracle_client = PriceOracleClient::new(&e, &oracle_contract_id);
        oracle_client.initialize(&admin);
        // Set price: 1 USD = 10,000,000 (7 decimals) => price = 10_000_000
        oracle_client.set_price(&token_addr, &10_000_000i128, &admin);

        // Initialize streaming contract with oracle
        let streaming_contract_id = e.register(StreamingPayments, ());
        let streaming_client = StreamingPaymentsClient::new(&e, &streaming_contract_id);
        streaming_client.initialize(&admin, &oracle_contract_id);

        // Create stable stream: deposit 10000 tokens, stream 100 USD per ledger, 100 ledgers
        e.ledger().set_sequence_number(100);
        let stream_id = streaming_client.create_stable_stream(
            &sender, &recipient, &token_addr,
            &10000, &100, &100, &200
        );

        // Advance to ledger 150 (50 ledgers elapsed)
        e.ledger().set_sequence_number(150);

        // Withdraw stable value
        streaming_client.withdraw_stable(&stream_id);

        // Expected token amount: 50 * 100 USD = 5000 USD
        // tokens = 5000 * 10^7 / 10_000_000 = 5000
        assert_eq!(token_client.balance(&recipient), 5000);

        // Verify stream state
        let stream = streaming_client.get_stream(&stream_id);
        assert_eq!(stream.withdrawn, 5000);
        assert_eq!(stream.usd_withdrawn, 5000);

        // Cancel stream: sender should get remaining 5000 tokens
        streaming_client.cancel_stream(&stream_id);
        assert_eq!(token_client.balance(&sender), 5000);
    }
}
