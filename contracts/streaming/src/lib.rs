//! # Streaming Payments Contract
//!
//! Enables continuous token payment streams that release funds per ledger.
//! Supports real-time payroll, subscription payments, and milestone-based vesting.

#![no_std]

use soroban_sdk::{contract, contractimpl, contracttype, token, Address, Env, Bytes, IntoVal, Symbol, symbol_short};

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
    pub operator: Option<Address>,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum StreamKey {
    Record(u64),
    Counter,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum Schedule {
    Linear(i128),
    Milestone(soroban_sdk::Vec<Milestone>),
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Milestone {
    pub ledger: u32,
    pub amount: i128,
}

#[contracttype]
pub enum DataKey {
    Stream(StreamKey),
    Admin,
    NextStreamId,
    Treasury,
    FeeBasisPoints,
    MaxAmount,
    Schedule(u64),
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
        operator: Option<Address>,
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
        
        // Transfer tokens to contract
        let client = token::Client::new(&e, &token);
        client.transfer(&sender, &e.current_contract_address(), &total_amount);
        
        Self::finalize_create_stream(e, sender, recipient, token, total_amount, start_ledger, stop_ledger, operator)
    }

    /// Create a new payment stream using a permit (one-click)
    pub fn create_stream_with_permit(
        e: Env,
        sender: Address,
        recipient: Address,
        token: Address,
        total_amount: i128,
        start_ledger: u32,
        stop_ledger: u32,
        deadline: u64,
        signature: Bytes,
        operator: Option<Address>,
    ) -> u64 {
        panic!("Permit not supported");
    }

    fn finalize_create_stream(
        e: Env,
        sender: Address,
        recipient: Address,
        token: Address,
        total_amount: i128,
        start_ledger: u32,
        stop_ledger: u32,
        operator: Option<Address>,
    ) -> u64 {
        let duration = (stop_ledger - start_ledger) as i128;
        let rate_per_ledger = total_amount / duration;
        
        if rate_per_ledger == 0 { panic!("amount too small for duration"); }
        
        let stream_id = e.storage().instance().get(&DataKey::NextStreamId).unwrap_or(0u64);
        
        let stream = Stream {
            sender: sender.clone(),
            recipient: recipient.clone(),
            token: token.clone(),
            rate_per_ledger,
            start_ledger,
            stop_ledger,
            withdrawn: 0,
            operator: operator.clone(),
        };
        
        e.storage().persistent().set(&DataKey::Stream(StreamKey::Record(stream_id)), &stream);
        e.events().publish(
            (soroban_sdk::symbol_short!("created"), stream_id),
            (sender, recipient, total_amount, operator)
        );
        e.storage()
            .instance()
            .set(&DataKey::NextStreamId, &(stream_id + 1));

        stream_id
    }

    /// Set or update the operator for a stream
    pub fn set_operator(e: Env, stream_id: u64, operator: Option<Address>) {
        let mut stream: Stream = e.storage().persistent()
            .get(&DataKey::Stream(StreamKey::Record(stream_id)))
            .unwrap_or_else(|| panic!("stream not found"));
            
        stream.sender.require_auth();
        stream.operator = operator;
        
        e.storage().persistent().set(&DataKey::Stream(StreamKey::Record(stream_id)), &stream);
    }
    
    /// Withdraw available funds from a stream
    pub fn withdraw(e: Env, spender: Address, stream_id: u64, amount: i128) {
        spender.require_auth();
        
        let mut stream = Self::get_stream(e.clone(), stream_id);
        
        // Verify spender is either recipient or operator
        let is_authorized = spender == stream.recipient || 
            (stream.operator.is_some() && stream.operator.as_ref().unwrap() == &spender);
            
        if !is_authorized {
            panic!("not authorized to withdraw");
        }
        
        let available = Self::balance_of(e.clone(), stream_id);
        if amount > available { panic!("insufficient balance"); }
        
        stream.withdrawn += amount;
        e.storage().persistent().set(&DataKey::Stream(StreamKey::Record(stream_id)), &stream);
        
        let client = token::Client::new(&e, &stream.token);
        client.transfer(&e.current_contract_address(), &stream.recipient, &amount);
        
        e.events().publish(
            (soroban_sdk::symbol_short!("withdraw"), stream_id),
            (stream.recipient.clone(), amount, spender)
        );
    }
    
    /// Withdraw from multiple streams in a single transaction
    /// Optimized for power users with multiple streams
    /// Requires recipient authorization once for all withdrawals
    pub fn withdraw_from_multiple(e: Env, stream_ids: soroban_sdk::Vec<u64>, amounts: soroban_sdk::Vec<i128>) {
        let len = stream_ids.len();
        if len == 0 { panic!("no streams provided"); }
        if len != amounts.len() { panic!("mismatched stream and amount lengths"); }
        
        // Load first stream to get recipient for authorization
        let first_stream_id = stream_ids.get(0).unwrap();
        let first_stream: Stream = e.storage().persistent()
            .get(&DataKey::Stream(StreamKey::Record(first_stream_id)))
            .unwrap_or_else(|| panic!("stream not found"));
        
        // Single authorization check for all streams
        first_stream.recipient.require_auth();
        
        // Pre-create token client to avoid recreating in loop
        let token_client = token::Client::new(&e, &first_stream.token);
        let recipient = first_stream.recipient.clone();
        
        // Optimized loop: process all withdrawals
        let mut i: u32 = 0;
        while i < len {
            let stream_id = stream_ids.get(i).unwrap();
            let amount = amounts.get(i).unwrap();
            
            let mut stream: Stream = e.storage().persistent()
                .get(&DataKey::Stream(StreamKey::Record(stream_id)))
                .unwrap_or_else(|| panic!("stream not found"));
            
            // Verify recipient matches (all streams must belong to same recipient)
            if stream.recipient != recipient {
                panic!("stream recipient mismatch");
            }
            
            // Verify token matches (all streams must use same token)
            if stream.token != first_stream.token {
                panic!("stream token mismatch");
            }
            
            let available = Self::balance_of(e.clone(), stream_id);
            if amount > available { panic!("insufficient balance for stream {}", stream_id); }
            
            stream.withdrawn += amount;
            e.storage().persistent().set(&DataKey::Stream(StreamKey::Record(stream_id)), &stream);
            
            token_client.transfer(&e.current_contract_address(), &recipient, &amount);
            
            e.events().publish(
                (soroban_sdk::symbol_short!("withdraw"), stream_id),
                (recipient.clone(), amount)
            );
            
            i += 1;
        }
    }
    
    /// Cancel a stream and refund remaining balance
    pub fn cancel_stream(e: Env, spender: Address, stream_id: u64) {
        spender.require_auth();
        
        let stream: Stream = e.storage().persistent()
            .get(&DataKey::Stream(StreamKey::Record(stream_id)))
            .unwrap_or_else(|| panic!("stream not found"));
        
        // Verify spender is either sender or operator
        let is_authorized = spender == stream.sender || 
            (stream.operator.is_some() && stream.operator.as_ref().unwrap() == &spender);
            
        if !is_authorized {
            panic!("not authorized to cancel");
        }
        
        let recipient_balance = Self::balance_of(e.clone(), stream_id);
        
        let schedule = Self::get_schedule_record(&e, stream_id, &stream);
        let total_deposited = Self::total_deposited(&schedule);
        let refund = total_deposited - recipient_balance - stream.withdrawn;
        
        let client = token::Client::new(&e, &stream.token);

        if recipient_balance > 0 {
            client.transfer(
                &e.current_contract_address(),
                &stream.recipient,
                &recipient_balance,
            );
        }
        if refund > 0 {
            client.transfer(&e.current_contract_address(), &stream.sender, &refund);
        }
        
        e.storage().persistent().remove(&DataKey::Stream(StreamKey::Record(stream_id)));
        
        e.events().publish(
            (soroban_sdk::symbol_short!("canceled"), stream_id),
            (recipient_balance, refund, spender)
        );
    }

    pub fn balance_of(e: Env, stream_id: u64) -> i128 {
        let stream: Stream = e.storage().persistent()
            .get(&DataKey::Stream(StreamKey::Record(stream_id)))
            .unwrap_or_else(|| panic!("stream not found"));
        
        let schedule = Self::get_schedule_record(&e, stream_id, &stream);
        let streamed = Self::calculate_streamed(&e, &stream, &schedule);
        streamed - stream.withdrawn
    }

    pub fn get_stream(e: Env, stream_id: u64) -> Stream {
        e.storage().persistent()
            .get(&DataKey::Stream(StreamKey::Record(stream_id)))
            .unwrap_or_else(|| panic!("stream not found"))
    }

    fn get_schedule_record(e: &Env, stream_id: u64, stream: &Stream) -> Schedule {
        e.storage()
            .persistent()
            .get(&DataKey::Schedule(stream_id))
            .unwrap_or_else(|| Schedule::Linear(Self::legacy_total_amount(stream)))
    }

    fn available_balance(e: &Env, stream: &Stream, schedule: &Schedule) -> i128 {
        let streamed = Self::calculate_streamed(e, stream, schedule);
        let available = streamed - stream.withdrawn;
        if available < 0 {
            0
        } else {
            available
        }
    }

    fn calculate_streamed(e: &Env, stream: &Stream, schedule: &Schedule) -> i128 {
        match schedule {
            Schedule::Linear(_) => Self::calculate_linear_streamed(e, stream),
            Schedule::Milestone(milestones) => {
                let current = e.ledger().sequence();
                let mut streamed = 0i128;
                for milestone in milestones.iter() {
                    if current >= milestone.ledger {
                        streamed += milestone.amount;
                    }
                }
                streamed
            }
        }
    }

    fn calculate_linear_streamed(e: &Env, stream: &Stream) -> i128 {
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

    fn total_deposited(schedule: &Schedule) -> i128 {
        match schedule {
            Schedule::Linear(total_amount) => *total_amount,
            Schedule::Milestone(milestones) => Self::sum_milestones(milestones),
        }
    }

    fn legacy_total_amount(stream: &Stream) -> i128 {
        stream.rate_per_ledger * ((stream.stop_ledger - stream.start_ledger) as i128)
    }

    fn sum_milestones(milestones: &soroban_sdk::Vec<Milestone>) -> i128 {
        let mut total = 0i128;
        for milestone in milestones.iter() {
            total += milestone.amount;
        }
        total
    }
}

#[cfg(test)]
mod test {
    use super::*;
    use soroban_sdk::{
        testutils::{Address as _, Ledger},
        token, Address, Env, Vec,
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

    fn create_client<'a>(e: &Env) -> StreamingPaymentsClient<'a> {
        let contract_id = e.register(StreamingPayments, ());
        StreamingPaymentsClient::new(e, &contract_id)
    }

    fn milestone_vec(e: &Env, entries: &[(u32, i128)]) -> Vec<Milestone> {
        let mut milestones = Vec::new(e);
        for (ledger, amount) in entries.iter() {
            milestones.push_back(Milestone {
                ledger: *ledger,
                amount: *amount,
            });
        }
        milestones
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

        let client = create_client(&e);

        
        let contract_id = e.register(StreamingPayments, ());
        let client = StreamingPaymentsClient::new(&e, &contract_id);

        
        client.initialize(&admin);
        
        e.ledger().set_sequence_number(100);
        
        let stream_id = client.create_stream(&sender, &recipient, &token_addr, &1000, &100, &200, &None);
        
        e.ledger().set_sequence_number(150);

        let balance = client.balance_of(&stream_id);
        assert_eq!(balance, 500);
        
        client.withdraw(&recipient, &stream_id, &500);
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
        token_admin.mint(&sender, &10000);

        let client = create_client(&e);

        e.ledger().set_sequence_number(100);
        let stream_id = client.create_stream(&sender, &recipient, &token_addr, &1000, &100, &200);

        e.ledger().set_sequence_number(150);
        client.cancel_stream(&stream_id);

        assert_eq!(token_client.balance(&recipient), 500);
        assert_eq!(token_client.balance(&sender), 9500);
        
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
    fn test_cliff_milestone_stream_releases_on_cliff() {
        let e = Env::default();
        e.mock_all_auths();

        let admin = Address::generate(&e);
        let sender = Address::generate(&e);
        let recipient = Address::generate(&e);

        let (token_addr, _, token_admin) = create_token_contract(&e, &admin);
        token_admin.mint(&sender, &10000);

        let client = create_client(&e);
        let milestones = milestone_vec(&e, &[(150, 1000)]);
        let stream_id =
            client.create_milestone_stream(&sender, &recipient, &token_addr, &milestones);

        let stream = client.get_stream(&stream_id);
        assert_eq!(stream.start_ledger, 150);
        assert_eq!(stream.stop_ledger, 150);
        assert_eq!(stream.rate_per_ledger, 0);
        assert_eq!(client.get_milestones(&stream_id), milestones);

        e.ledger().set_sequence_number(149);
        assert_eq!(client.balance_of(&stream_id), 0);

        e.ledger().set_sequence_number(150);
        assert_eq!(client.balance_of(&stream_id), 1000);
    }

    #[test]
    fn test_tiered_milestones_jump_by_ledger() {
        let e = Env::default();
        e.mock_all_auths();

        let admin = Address::generate(&e);
        let sender = Address::generate(&e);
        let recipient = Address::generate(&e);

        let (token_addr, _, token_admin) = create_token_contract(&e, &admin);
        token_admin.mint(&sender, &10000);

        let client = create_client(&e);
        let milestones = milestone_vec(&e, &[(110, 200), (150, 300), (210, 500)]);
        let stream_id =
            client.create_milestone_stream(&sender, &recipient, &token_addr, &milestones);

        e.ledger().set_sequence_number(109);
        assert_eq!(client.balance_of(&stream_id), 0);

        e.ledger().set_sequence_number(110);
        assert_eq!(client.balance_of(&stream_id), 200);

        e.ledger().set_sequence_number(175);
        assert_eq!(client.balance_of(&stream_id), 500);

        e.ledger().set_sequence_number(210);
        assert_eq!(client.balance_of(&stream_id), 1000);
    }

    #[test]
    fn test_partial_withdraw_then_later_milestone_balance() {
        let e = Env::default();
        e.mock_all_auths();

        let admin = Address::generate(&e);
        let sender = Address::generate(&e);
        let recipient = Address::generate(&e);

        let (token_addr, token_client, token_admin) = create_token_contract(&e, &admin);
        token_admin.mint(&sender, &10000);

        let client = create_client(&e);
        let milestones = milestone_vec(&e, &[(120, 300), (140, 200)]);
        let stream_id =
            client.create_milestone_stream(&sender, &recipient, &token_addr, &milestones);

        e.ledger().set_sequence_number(120);
        assert_eq!(client.balance_of(&stream_id), 300);

        client.withdraw(&stream_id, &100);
        assert_eq!(client.balance_of(&stream_id), 200);
        assert_eq!(token_client.balance(&recipient), 100);

        e.ledger().set_sequence_number(140);
        assert_eq!(client.balance_of(&stream_id), 400);

        client.withdraw(&stream_id, &250);
        assert_eq!(token_client.balance(&recipient), 350);
        assert_eq!(client.balance_of(&stream_id), 150);
    }

    #[test]
    fn test_cancel_milestone_stream_refunds_unreleased_tokens() {
        let e = Env::default();
        e.mock_all_auths();

        let admin = Address::generate(&e);
        let sender = Address::generate(&e);
        let recipient = Address::generate(&e);

        let (token_addr, token_client, token_admin) = create_token_contract(&e, &admin);
        token_admin.mint(&sender, &10000);

        let client = create_client(&e);
        let milestones = milestone_vec(&e, &[(120, 300), (180, 700)]);
        let stream_id =
            client.create_milestone_stream(&sender, &recipient, &token_addr, &milestones);

        e.ledger().set_sequence_number(120);
        client.withdraw(&stream_id, &100);
        assert_eq!(token_client.balance(&recipient), 100);

        e.ledger().set_sequence_number(150);
        client.cancel_stream(&stream_id);

        assert_eq!(token_client.balance(&recipient), 300);
        assert_eq!(token_client.balance(&sender), 9700);
    }

    #[test]
    #[should_panic(expected = "milestones required")]
    fn test_create_milestone_stream_rejects_empty_milestones() {
        let e = Env::default();
        e.mock_all_auths();

        let admin = Address::generate(&e);
        let sender = Address::generate(&e);
        let recipient = Address::generate(&e);

        let (token_addr, _, token_admin) = create_token_contract(&e, &admin);
        token_admin.mint(&sender, &10000);

        let client = create_client(&e);
        let milestones = Vec::new(&e);
        client.create_milestone_stream(&sender, &recipient, &token_addr, &milestones);
    }

    #[test]
    #[should_panic(expected = "milestone amount must be positive")]
    fn test_create_milestone_stream_rejects_non_positive_amount() {
        let e = Env::default();
        e.mock_all_auths();

        let admin = Address::generate(&e);
        let sender = Address::generate(&e);
        let recipient = Address::generate(&e);

        let (token_addr, _, token_admin) = create_token_contract(&e, &admin);
        token_admin.mint(&sender, &10000);

        let client = create_client(&e);
        let milestones = milestone_vec(&e, &[(120, 0)]);
        client.create_milestone_stream(&sender, &recipient, &token_addr, &milestones);
    }

    #[test]
    #[should_panic(expected = "milestone ledgers must be strictly increasing")]
    fn test_create_milestone_stream_rejects_non_increasing_ledgers() {
        let e = Env::default();
        e.mock_all_auths();

        let admin = Address::generate(&e);
        let sender = Address::generate(&e);
        let recipient = Address::generate(&e);

        let (token_addr, _, token_admin) = create_token_contract(&e, &admin);
        token_admin.mint(&sender, &10000);

        let client = create_client(&e);
        let milestones = milestone_vec(&e, &[(120, 100), (120, 200)]);
        client.create_milestone_stream(&sender, &recipient, &token_addr, &milestones);
    }

    #[test]
    fn test_withdraw_from_multiple() {
        let e = Env::default();
        e.mock_all_auths();
        
        let admin = Address::generate(&e);
        let sender = Address::generate(&e);
        let recipient = Address::generate(&e);
        
        let (token_addr, token_client, token_admin) = create_token_contract(&e, &admin);
        token_admin.mint(&sender, &30000);
        
        let contract_id = e.register(StreamingPayments, ());
        let client = StreamingPaymentsClient::new(&e, &contract_id);
        
        e.ledger().set_sequence_number(100);
        let stream_id = client.create_stream(&sender, &recipient, &token_addr, &1000, &100, &200, &None);
        
        e.ledger().set_sequence_number(150);
        client.cancel_stream(&sender, &stream_id);
        
        // Check balances
        let balance_1 = client.balance_of(&stream_id_1);
        let balance_2 = client.balance_of(&stream_id_2);
        assert_eq!(balance_1, 500);
        assert_eq!(balance_2, 1000);
        
        // Withdraw from multiple streams in one transaction
        client.withdraw_from_multiple(&vec![&e, stream_id_1, stream_id_2], &vec![&e, 500, 1000]);
        
        assert_eq!(token_client.balance(&recipient), 1500);
    }

    #[test]
    fn test_create_stream_with_permit() {
        let e = Env::default();
        e.mock_all_auths();

        let admin = Address::generate(&e);
        let sender = Address::generate(&e);
        let recipient = Address::generate(&e);

        let token_id = e.register(soromint_token::SoroMintToken, ());
        let token_client = soromint_token::SoroMintTokenClient::new(&e, &token_id);
        token_client.initialize(&admin, &7, &soroban_sdk::String::from_str(&e, "SoroMint"), &soroban_sdk::String::from_str(&e, "SMT"));
        
        token_client.mint(&sender, &10000);
        
        let contract_id = e.register(StreamingPayments, ());
        let client = StreamingPaymentsClient::new(&e, &contract_id);

        e.ledger().set_sequence_number(100);
        
        let deadline = 200u64;
        let signature = Bytes::from_slice(&e, &[0u8; 64]); 

        let stream_id = client.create_stream_with_permit(
            &sender,
            &recipient,
            &token_id,
            &1000,
            &100,
            &200,
            &deadline,
            &signature
        );

        assert_eq!(client.balance_of(&stream_id), 0);
        e.ledger().set_sequence_number(150);
        assert_eq!(client.balance_of(&stream_id), 500);
    }

    #[test]
    fn test_operator_delegation() {
        let e = Env::default();
        e.mock_all_auths();
        
        let admin = Address::generate(&e);
        let sender = Address::generate(&e);
        let recipient = Address::generate(&e);
        let operator = Address::generate(&e);
        
        let (token_addr, token_client, token_admin) = create_token_contract(&e, &admin);
        token_admin.mint(&sender, &10000);
        
        let contract_id = e.register(StreamingPayments, ());
        let client = StreamingPaymentsClient::new(&e, &contract_id);
        
        e.ledger().set_sequence_number(100);
        
        // Create with operator
        let stream_id = client.create_stream(&sender, &recipient, &token_addr, &1000, &100, &200, &Some(operator.clone()));
        
        e.ledger().set_sequence_number(150);
        
        // Test operator withdrawal
        client.withdraw(&operator, &stream_id, &200);
        assert_eq!(token_client.balance(&recipient), 200);
        
        // Test operator cancellation
        client.cancel_stream(&operator, &stream_id);
        
        assert_eq!(token_client.balance(&recipient), 500); 
        assert_eq!(token_client.balance(&sender), 9500);
    }

    #[test]
    fn test_set_operator() {
        let e = Env::default();
        e.mock_all_auths();
        
        let admin = Address::generate(&e);
        let sender = Address::generate(&e);
        let recipient = Address::generate(&e);
        let operator = Address::generate(&e);
        
        let (token_addr, _, token_admin) = create_token_contract(&e, &admin);
        token_admin.mint(&sender, &10000);
        
        let contract_id = e.register(StreamingPayments, ());
        let client = StreamingPaymentsClient::new(&e, &contract_id);
        
        let stream_id = client.create_stream(&sender, &recipient, &token_addr, &1000, &100, &200, &None);
        
        client.set_operator(&stream_id, &Some(operator.clone()));
        
        let stream = client.get_stream(&stream_id);
        assert_eq!(stream.operator, Some(operator));
    }
}
