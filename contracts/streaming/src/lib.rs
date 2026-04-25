//! # Streaming Payments Contract
//!
//! Enables continuous token payment streams that release funds per ledger.
//! Supports real-time payroll and subscription-based payment models.

#![no_std]

use soroban_sdk::{contract, contractimpl, contracttype, token, Address, BytesN, Env};

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
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PrivateStreamStub {
    pub sender: Address,
    pub recipient: Address,
    pub token: Address,
    pub amount_commitment: BytesN<32>,
    pub rate_commitment: BytesN<32>,
    pub withdrawn_commitment: BytesN<32>,
    pub start_ledger: u32,
    pub stop_ledger: u32,
    pub verifier: Address,
}

#[contracttype]
pub enum DataKey {
    Stream(u64),
    NextStreamId,
    PrivateStream(u64),
    NextPrivateStreamId,
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

        if total_amount <= 0 {
            panic!("amount must be positive");
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

    /// Withdraw available funds from a stream
    pub fn withdraw(e: Env, stream_id: u64, amount: i128) {
        let mut stream: Stream = e
            .storage()
            .persistent()
            .get(&DataKey::Stream(stream_id))
            .unwrap_or_else(|| panic!("stream not found"));

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

    /// Cancel a stream and refund remaining balance
    pub fn cancel_stream(e: Env, stream_id: u64) {
        let stream: Stream = e
            .storage()
            .persistent()
            .get(&DataKey::Stream(stream_id))
            .unwrap_or_else(|| panic!("stream not found"));

        stream.sender.require_auth();

        let recipient_balance = Self::balance_of(e.clone(), stream_id);
        let client = token::Client::new(&e, &stream.token);

        // Transfer available balance to recipient
        if recipient_balance > 0 {
            client.transfer(
                &e.current_contract_address(),
                &stream.recipient,
                &recipient_balance,
            );
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
            (recipient_balance, refund),
        );
    }

    /// Get available balance for withdrawal
    pub fn balance_of(e: Env, stream_id: u64) -> i128 {
        let stream: Stream = e
            .storage()
            .persistent()
            .get(&DataKey::Stream(stream_id))
            .unwrap_or_else(|| panic!("stream not found"));

        let streamed = Self::calculate_streamed(&e, &stream);
        streamed - stream.withdrawn
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
    use soroban_sdk::{
        testutils::{Address as _, Ledger},
        token, Address, Env,
    };

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
}
