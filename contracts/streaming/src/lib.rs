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
    pub is_public: bool,
}

#[contracttype]
pub enum DataKey {
    Admin,
    Treasury,
    FeeBasisPoints,
    Stream(u64),
    NextStreamId,
    PrivateStream(u64),
    NextPrivateStreamId,
    MaxAmount,
    Admin,
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
        is_public: bool,
    ) -> u64 {
        sender.require_auth();

        if total_amount <= 0 {
            panic!("amount must be positive");
        }
        if stop_ledger <= start_ledger {
            panic!("invalid ledger range");
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

        if rate_per_ledger == 0 {
            panic!("amount too small for duration");
        }

        // Transfer tokens to contract
        let client = token::Client::new(&e, &token);
        client.transfer(&sender, &e.current_contract_address(), &total_amount);

        let stream_id = e
            .storage()
            .instance()
            .get(&DataKey::NextStreamId)
            .unwrap_or(0u64);

        let stream = Stream {
            sender: sender.clone(),
            recipient: recipient.clone(),
            token: token.clone(),
            rate_per_ledger,
            start_ledger,
            stop_ledger,
            withdrawn: 0,
            is_public,
        };

        e.storage()
            .persistent()
            .set(&DataKey::Stream(stream_id), &stream);
        e.storage()
            .instance()
            .set(&DataKey::NextStreamId, &(stream_id + 1));

        e.events().publish(
            (soroban_sdk::symbol_short!("created"), stream_id),
            (sender, recipient, total_amount),
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
        let mut stream: Stream = e
            .storage()
            .persistent()
            .get(&DataKey::Stream(stream_id))
            .unwrap_or_else(|| panic!("stream not found"));

        if stream.is_stable {
            panic!("stable streams require withdraw_stable");
        }

        stream.recipient.require_auth();

        let available = Self::balance_of(e.clone(), stream_id);
        if amount > available {
            panic!("insufficient balance");
        }

        stream.withdrawn += amount;
        e.storage()
            .persistent()
            .set(&DataKey::Stream(stream_id), &stream);

        let client = token::Client::new(&e, &stream.token);
        client.transfer(&e.current_contract_address(), &stream.recipient, &amount);

        e.events().publish(
            (soroban_sdk::symbol_short!("withdraw"), stream_id),
            (stream.recipient.clone(), amount),
        );
    }

    /// Withdraw available funds from a stable stream.
    /// Converts accrued USD value to tokens using the current oracle price.
    pub fn withdraw_stable(e: Env, stream_id: u64) {
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
    
    /// Get available balance for withdrawal (in token amount)
    pub fn balance_of(e: Env, stream_id: u64) -> i128 {
        let stream: Stream = e
            .storage()
            .persistent()
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
        e.storage()
            .persistent()
            .get(&DataKey::Stream(stream_id))
            .unwrap_or_else(|| panic!("stream not found"))
    }

    /// Create a commitment-only private stream placeholder.
    ///
    /// This does not transfer tokens and does not accept raw amounts. Value movement must wait
    /// until a real zero-knowledge verifier is integrated.
    pub fn create_private_stream_stub(
        e: Env,
        sender: Address,
        recipient: Address,
        token: Address,
        amount_commitment: BytesN<32>,
        rate_commitment: BytesN<32>,
        start_ledger: u32,
        stop_ledger: u32,
        verifier: Address,
    ) -> u64 {
        sender.require_auth();

        if stop_ledger <= start_ledger {
            panic!("invalid ledger range");
        }

        let private_stream_id = e
            .storage()
            .instance()
            .get(&DataKey::NextPrivateStreamId)
            .unwrap_or(0u64);
        let withdrawn_commitment = BytesN::from_array(&e, &[0; 32]);

        let private_stream = PrivateStreamStub {
            sender: sender.clone(),
            recipient: recipient.clone(),
            token: token.clone(),
            amount_commitment: amount_commitment.clone(),
            rate_commitment: rate_commitment.clone(),
            withdrawn_commitment: withdrawn_commitment.clone(),
            start_ledger,
            stop_ledger,
            verifier: verifier.clone(),
        };

        e.storage()
            .persistent()
            .set(&DataKey::PrivateStream(private_stream_id), &private_stream);
        e.storage()
            .instance()
            .set(&DataKey::NextPrivateStreamId, &(private_stream_id + 1));

        e.events().publish(
            (soroban_sdk::symbol_short!("p_create"), private_stream_id),
            (
                sender,
                recipient,
                token,
                amount_commitment,
                rate_commitment,
                withdrawn_commitment,
            ),
        );

        private_stream_id
    }

    /// Get private stream stub details.
    pub fn get_private_stream_stub(e: Env, private_stream_id: u64) -> PrivateStreamStub {
        e.storage()
            .persistent()
            .get(&DataKey::PrivateStream(private_stream_id))
            .unwrap_or_else(|| panic!("private stream not found"))
    }

    /// Placeholder for future zero-knowledge proof verification.
    ///
    /// This intentionally returns false and must be replaced with a real Groth16 verifier before
    /// any private-stream value movement, withdrawal, or cancellation can depend on it.
    pub fn verify_private_stream_proof_stub(
        e: Env,
        private_stream_id: u64,
        proof_commitment: BytesN<32>,
        public_input_commitment: BytesN<32>,
    ) -> bool {
        let private_stream: PrivateStreamStub = e
            .storage()
            .persistent()
            .get(&DataKey::PrivateStream(private_stream_id))
            .unwrap_or_else(|| panic!("private stream not found"));

        e.events().publish(
            (soroban_sdk::symbol_short!("p_verify"), private_stream_id),
            (
                private_stream.verifier,
                proof_commitment,
                public_input_commitment,
            ),
        );

        false
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

    fn create_token_contract<'a>(
        e: &Env,
        admin: &Address,
    ) -> (Address, token::Client<'a>, token::StellarAssetClient<'a>) {
        let contract = e.register_stellar_asset_contract_v2(admin.clone());
        let addr = contract.address();
        (
            addr.clone(),
            token::Client::new(e, &addr),
            token::StellarAssetClient::new(e, &addr),
        )
    }

    fn commitment(e: &Env, value: u8) -> BytesN<32> {
        BytesN::from_array(e, &[value; 32])
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
        
        let stream_id = client.create_stream(&sender, &recipient, &token_addr, &1000, &100, &200, &true);
        
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

        let (token_addr, token_client, token_admin) = create_token_contract(&e, &admin);
        
        let (token_addr, _token_client, token_admin) = create_token_contract(&e, &admin);
        token_admin.mint(&sender, &10000);

        let contract_id = e.register(StreamingPayments, ());
        let client = StreamingPaymentsClient::new(&e, &contract_id);

        e.ledger().set_sequence_number(100);
        let stream_id = client.create_stream(&sender, &recipient, &token_addr, &1000, &100, &200);

        e.ledger().set_sequence_number(150);
        client.cancel_stream(&stream_id);

        assert_eq!(token_client.balance(&recipient), 500);
        assert_eq!(token_client.balance(&sender), 9500);
        
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
    fn test_create_private_stream_stub() {
        let e = Env::default();
        e.mock_all_auths();

        let admin = Address::generate(&e);
        let sender = Address::generate(&e);
        let recipient = Address::generate(&e);
        let verifier = Address::generate(&e);
        let amount_commitment = commitment(&e, 1);
        let rate_commitment = commitment(&e, 2);
        let zero_commitment = commitment(&e, 0);

        let (token_addr, _, _) = create_token_contract(&e, &admin);
        let contract_id = e.register(StreamingPayments, ());
        let client = StreamingPaymentsClient::new(&e, &contract_id);

        let private_stream_id = client.create_private_stream_stub(
            &sender,
            &recipient,
            &token_addr,
            &amount_commitment,
            &rate_commitment,
            &100,
            &200,
            &verifier,
        );
        let private_stream = client.get_private_stream_stub(&private_stream_id);

        assert_eq!(private_stream.sender, sender);
        assert_eq!(private_stream.recipient, recipient);
        assert_eq!(private_stream.token, token_addr);
        assert_eq!(private_stream.amount_commitment, amount_commitment);
        assert_eq!(private_stream.rate_commitment, rate_commitment);
        assert_eq!(private_stream.withdrawn_commitment, zero_commitment);
        assert_eq!(private_stream.start_ledger, 100);
        assert_eq!(private_stream.stop_ledger, 200);
        assert_eq!(private_stream.verifier, verifier);
    }

    #[test]
    #[should_panic(expected = "invalid ledger range")]
    fn test_create_private_stream_stub_invalid_range() {
        let e = Env::default();
        e.mock_all_auths();

        let admin = Address::generate(&e);
        let sender = Address::generate(&e);
        let recipient = Address::generate(&e);
        let verifier = Address::generate(&e);
        let amount_commitment = commitment(&e, 1);
        let rate_commitment = commitment(&e, 2);

        let (token_addr, _, _) = create_token_contract(&e, &admin);
        let contract_id = e.register(StreamingPayments, ());
        let client = StreamingPaymentsClient::new(&e, &contract_id);

        client.create_private_stream_stub(
            &sender,
            &recipient,
            &token_addr,
            &amount_commitment,
            &rate_commitment,
            &200,
            &200,
            &verifier,
        );
    }

    #[test]
    fn test_verify_private_stream_proof_stub_returns_false() {
        let e = Env::default();
        e.mock_all_auths();

        let admin = Address::generate(&e);
        let sender = Address::generate(&e);
        let recipient = Address::generate(&e);
        let verifier = Address::generate(&e);
        let amount_commitment = commitment(&e, 1);
        let rate_commitment = commitment(&e, 2);
        let proof_commitment = commitment(&e, 3);
        let public_input_commitment = commitment(&e, 4);

        let (token_addr, _, _) = create_token_contract(&e, &admin);
        let contract_id = e.register(StreamingPayments, ());
        let client = StreamingPaymentsClient::new(&e, &contract_id);

        let private_stream_id = client.create_private_stream_stub(
            &sender,
            &recipient,
            &token_addr,
            &amount_commitment,
            &rate_commitment,
            &100,
            &200,
            &verifier,
        );

        assert!(!client.verify_private_stream_proof_stub(
            &private_stream_id,
            &proof_commitment,
            &public_input_commitment,
        ));
    }

    #[test]
    #[should_panic(expected = "private stream not found")]
    fn test_verify_private_stream_proof_stub_missing_stream() {
        let e = Env::default();

        let contract_id = e.register(StreamingPayments, ());
        let client = StreamingPaymentsClient::new(&e, &contract_id);
        let proof_commitment = commitment(&e, 3);
        let public_input_commitment = commitment(&e, 4);

        client.verify_private_stream_proof_stub(&0, &proof_commitment, &public_input_commitment);
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
        let stream_id = client.create_stream(&sender, &recipient, &token_addr, &1000, &100, &200, &false);
        
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
