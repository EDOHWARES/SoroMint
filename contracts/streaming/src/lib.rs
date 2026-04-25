//! # Streaming Payments Contract
//!
//! Enables continuous token payment streams that release funds per ledger.
//! Supports real-time payroll, subscription payments, and milestone-based vesting.

#![no_std]

use soroban_sdk::{contract, contractimpl, contracttype, symbol_short, token, Address, Env, Vec};

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
pub struct Milestone {
    pub ledger: u32,
    pub amount: i128,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum Schedule {
    Linear(i128),
    Milestone(Vec<Milestone>),
}

#[contracttype]
pub enum DataKey {
    Stream(u64),
    Schedule(u64),
    NextStreamId,
}

#[contract]
pub struct StreamingPayments;

#[contractimpl]
impl StreamingPayments {
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

        token::Client::new(&e, &token).transfer(
            &sender,
            &e.current_contract_address(),
            &total_amount,
        );

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
        e.storage().persistent().set(
            &DataKey::Schedule(stream_id),
            &Schedule::Linear(total_amount),
        );
        e.storage()
            .instance()
            .set(&DataKey::NextStreamId, &(stream_id + 1));

        e.events().publish(
            (symbol_short!("created"), stream_id),
            (sender, recipient, total_amount),
        );

        stream_id
    }

    pub fn create_milestone_stream(
        e: Env,
        sender: Address,
        recipient: Address,
        token: Address,
        milestones: Vec<Milestone>,
    ) -> u64 {
        sender.require_auth();

        if milestones.is_empty() {
            panic!("milestones required");
        }

        let mut total_amount = 0i128;
        let mut start_ledger = 0u32;
        let mut stop_ledger = 0u32;
        let mut previous_ledger = 0u32;
        let mut is_first = true;

        for milestone in milestones.iter() {
            if milestone.amount <= 0 {
                panic!("milestone amount must be positive");
            }
            if is_first {
                start_ledger = milestone.ledger;
                previous_ledger = milestone.ledger;
                is_first = false;
            } else if milestone.ledger <= previous_ledger {
                panic!("milestone ledgers must be strictly increasing");
            } else {
                previous_ledger = milestone.ledger;
            }
            stop_ledger = milestone.ledger;
            total_amount += milestone.amount;
        }

        if total_amount <= 0 {
            panic!("amount must be positive");
        }

        token::Client::new(&e, &token).transfer(
            &sender,
            &e.current_contract_address(),
            &total_amount,
        );

        let stream_id = e
            .storage()
            .instance()
            .get(&DataKey::NextStreamId)
            .unwrap_or(0u64);
        let stream = Stream {
            sender: sender.clone(),
            recipient: recipient.clone(),
            token: token.clone(),
            rate_per_ledger: 0,
            start_ledger,
            stop_ledger,
            withdrawn: 0,
        };

        e.storage()
            .persistent()
            .set(&DataKey::Stream(stream_id), &stream);
        e.storage().persistent().set(
            &DataKey::Schedule(stream_id),
            &Schedule::Milestone(milestones.clone()),
        );
        e.storage()
            .instance()
            .set(&DataKey::NextStreamId, &(stream_id + 1));

        e.events().publish(
            (symbol_short!("created"), stream_id),
            (sender, recipient, total_amount),
        );
        e.events().publish(
            (symbol_short!("msched"), stream_id),
            (start_ledger, stop_ledger, total_amount),
        );

        stream_id
    }

    pub fn withdraw(e: Env, stream_id: u64, amount: i128) {
        let mut stream = Self::get_stream_record(&e, stream_id);

        stream.recipient.require_auth();

        let available = Self::balance_of(e.clone(), stream_id);
        if amount > available {
            panic!("insufficient balance");
        }

        stream.withdrawn += amount;
        e.storage()
            .persistent()
            .set(&DataKey::Stream(stream_id), &stream);

        token::Client::new(&e, &stream.token).transfer(
            &e.current_contract_address(),
            &stream.recipient,
            &amount,
        );

        e.events().publish(
            (symbol_short!("withdraw"), stream_id),
            (stream.recipient.clone(), amount),
        );
    }

    pub fn cancel_stream(e: Env, stream_id: u64) {
        let stream = Self::get_stream_record(&e, stream_id);
        stream.sender.require_auth();

        let schedule = Self::get_schedule_record(&e, stream_id, &stream);
        let recipient_balance = Self::available_balance(&e, &stream, &schedule);
        let total_streamed = Self::calculate_streamed(&e, &stream, &schedule);
        let refund = Self::total_deposited(&schedule) - total_streamed;
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

        e.storage().persistent().remove(&DataKey::Stream(stream_id));
        e.storage()
            .persistent()
            .remove(&DataKey::Schedule(stream_id));

        e.events().publish(
            (symbol_short!("canceled"), stream_id),
            (recipient_balance, refund),
        );
    }

    pub fn balance_of(e: Env, stream_id: u64) -> i128 {
        let stream = Self::get_stream_record(&e, stream_id);
        let schedule = Self::get_schedule_record(&e, stream_id, &stream);
        Self::available_balance(&e, &stream, &schedule)
    }

    pub fn get_stream(e: Env, stream_id: u64) -> Stream {
        Self::get_stream_record(&e, stream_id)
    }

    pub fn get_schedule(e: Env, stream_id: u64) -> Schedule {
        let stream = Self::get_stream_record(&e, stream_id);
        Self::get_schedule_record(&e, stream_id, &stream)
    }

    pub fn get_milestones(e: Env, stream_id: u64) -> Vec<Milestone> {
        match Self::get_schedule(e.clone(), stream_id) {
            Schedule::Linear(_) => Vec::new(&e),
            Schedule::Milestone(milestones) => milestones,
        }
    }

    fn get_stream_record(e: &Env, stream_id: u64) -> Stream {
        e.storage()
            .persistent()
            .get(&DataKey::Stream(stream_id))
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

    fn sum_milestones(milestones: &Vec<Milestone>) -> i128 {
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

        e.ledger().set_sequence_number(100);

        let stream_id = client.create_stream(&sender, &recipient, &token_addr, &1000, &100, &200);

        e.ledger().set_sequence_number(150);

        let balance = client.balance_of(&stream_id);
        assert_eq!(balance, 500);
        assert_eq!(client.get_schedule(&stream_id), Schedule::Linear(1000));
        assert_eq!(client.get_milestones(&stream_id), Vec::new(&e));

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

        let client = create_client(&e);

        e.ledger().set_sequence_number(100);
        let stream_id = client.create_stream(&sender, &recipient, &token_addr, &1000, &100, &200);

        e.ledger().set_sequence_number(150);
        client.cancel_stream(&stream_id);

        assert_eq!(token_client.balance(&recipient), 500);
        assert_eq!(token_client.balance(&sender), 9500);
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
}
