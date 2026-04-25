#![cfg(test)]

use super::*;
use soroban_sdk::{
    contract, contractimpl,
    testutils::{Address as _, Events as _},
    Address, Env, Symbol, Vec,
};

// Event topic constants
const BLACKLIST_UPDATED: Symbol = symbol_short!("bl_upd");
const CLAWBACK_TOPIC: Symbol = symbol_short!("clwbk");

// --- Mock Token Contract for Clawback Integration Tests ---

#[contracttype]
#[derive(Clone)]
enum MockTokenKey {
    Admin,
    ClawbackAdmin,
    Balance(Address),
    Supply,
}

#[contract]
pub struct MockToken;

#[contractimpl]
impl MockToken {
    pub fn initialize(e: Env, admin: Address, clawback_admin: Address) {
        if e.storage().instance().has(&MockTokenKey::Admin) {
            panic!("already initialized");
        }
        e.storage().instance().set(&MockTokenKey::Admin, &admin);
        e.storage().instance().set(&MockTokenKey::ClawbackAdmin, &clawback_admin);
        e.storage().instance().set(&MockTokenKey::Supply, &0i128);
    }

    pub fn set_balance(e: Env, admin: Address, addr: Address, amount: i128) {
        admin.require_auth();
        e.storage().persistent().set(&MockTokenKey::Balance(addr), &amount);
    }

    pub fn set_supply(e: Env, admin: Address, supply: i128) {
        admin.require_auth();
        e.storage().instance().set(&MockTokenKey::Supply, &supply);
    }

    pub fn get_balance(e: Env, addr: Address) -> i128 {
        e.storage().persistent().get(&MockTokenKey::Balance(addr)).unwrap_or(0)
    }

    pub fn get_supply(e: Env) -> i128 {
        e.storage().instance().get(&MockTokenKey::Supply).unwrap()
    }

    pub fn clawback(e: Env, from: Address, amount: i128) {
        let clawback_admin: Address = e.storage().instance().get(&MockTokenKey::ClawbackAdmin).unwrap();
        clawback_admin.require_auth();

        let from_balance = e.storage().persistent().get::<_, i128>(&MockTokenKey::Balance(from.clone())).unwrap_or(0);
        if from_balance < amount {
            panic!("insufficient balance for clawback");
        }
        e.storage().persistent().set(&MockTokenKey::Balance(from), &(from_balance - amount));

        let mut supply = e.storage().instance().get::<_, i128>(&MockTokenKey::Supply).unwrap();
        supply -= amount;
        e.storage().instance().set(&MockTokenKey::Supply, &supply);
    }
}

// --- Compliance Contract Tests ---

#[test]
fn test_initialize_success() {
    let e = Env::default();
    e.mock_all_auths();

    let admin = Address::generate(&e);
    let clawback_admin = Address::generate(&e);
    let token_addr = Address::generate(&e);
    let default_jur = Jurisdiction::US;

    let contract_id = e.register(ComplianceContract, ());
    let client = ComplianceContractClient::new(&e, &contract_id);

    client.initialize(&admin, &clawback_admin, &token_addr, &default_jur);

    assert_eq!(client.get_admin(), admin);
    assert_eq!(client.get_clawback_admin(), clawback_admin);
    assert_eq!(client.get_token_address(), token_addr);
    assert_eq!(client.get_default_jurisdiction(), Jurisdiction::US);
}

#[test]
#[should_panic(expected = "already initialized")]
fn test_initialize_twice_panics() {
    let e = Env::default();
    e.mock_all_auths();

    let admin = Address::generate(&e);
    let contract_id = e.register(ComplianceContract, ());
    let client = ComplianceContractClient::new(&e, &contract_id);
    let token = Address::generate(&e);
    let jur = Jurisdiction::GLOBAL;

    client.initialize(&admin, &Address::generate(&e), &token, &jur);
    let client2 = ComplianceContractClient::new(&e, &contract_id);
    client2.initialize(&admin, &Address::generate(&e), &token, &jur);
}

#[test]
fn test_get_admin_returns_initial() {
    let e = Env::default();
    let admin = Address::generate(&e);
    let contract_id = e.register(ComplianceContract, ());
    let client = ComplianceContractClient::new(&e, &contract_id);
    let token = Address::generate(&e);
    let jur = Jurisdiction::GLOBAL;
    client.initialize(&admin, &Address::generate(&e), &token, &jur);
    assert_eq!(client.get_admin(), admin);
}

#[test]
fn test_set_admin_success() {
    let e = Env::default();
    e.mock_all_auths();

    let admin = Address::generate(&e);
    let new_admin = Address::generate(&e);
    let contract_id = e.register(ComplianceContract, ());
    let client = ComplianceContractClient::new(&e, &contract_id);
    let token = Address::generate(&e);
    let jur = Jurisdiction::GLOBAL;

    client.initialize(&admin, &Address::generate(&e), &token, &jur);
    client.set_admin(&admin, &new_admin);
    assert_eq!(client.get_admin(), new_admin);
}

#[test]
#[should_panic(expected = "Unauthorized: not admin")]
fn test_set_admin_unauthorized_fails() {
    let e = Env::default();
    e.mock_all_auths();

    let admin = Address::generate(&e);
    let impostor = Address::generate(&e);
    let contract_id = e.register(ComplianceContract, ());
    let client = ComplianceContractClient::new(&e, &contract_id);
    let token = Address::generate(&e);
    let jur = Jurisdiction::GLOBAL;
    client.initialize(&admin, &Address::generate(&e), &token, &jur);

    let client2 = ComplianceContractClient::new(&e, &contract_id);
    client2.set_admin(&impostor, &admin);
}

#[test]
fn test_set_clawback_admin_success() {
    let e = Env::default();
    e.mock_all_auths();

    let admin = Address::generate(&e);
    let clawback_admin = Address::generate(&e);
    let new_clawback = Address::generate(&e);
    let contract_id = e.register(ComplianceContract, ());
    let client = ComplianceContractClient::new(&e, &contract_id);
    let token = Address::generate(&e);
    let jur = Jurisdiction::GLOBAL;

    client.initialize(&admin, &clawback_admin, &token, &jur);
    client.set_clawback_admin(&admin, &new_clawback);
    assert_eq!(client.get_clawback_admin(), new_clawback);
}

#[test]
#[should_panic(expected = "Unauthorized: not admin")]
fn test_set_clawback_admin_unauthorized_fails() {
    let e = Env::default();
    e.mock_all_auths();

    let admin = Address::generate(&e);
    let impostor = Address::generate(&e);
    let contract_id = e.register(ComplianceContract, ());
    let client = ComplianceContractClient::new(&e, &contract_id);
    let token = Address::generate(&e);
    let jur = Jurisdiction::GLOBAL;
    client.initialize(&admin, &Address::generate(&e), &token, &jur);

    let client2 = ComplianceContractClient::new(&e, &contract_id);
    client2.set_clawback_admin(&impostor, &admin);
}

#[test]
fn test_set_token_address_success() {
    let e = Env::default();
    e.mock_all_auths();

    let admin = Address::generate(&e);
    let token1 = Address::generate(&e);
    let token2 = Address::generate(&e);
    let contract_id = e.register(ComplianceContract, ());
    let client = ComplianceContractClient::new(&e, &contract_id);
    let jur = Jurisdiction::GLOBAL;

    client.initialize(&admin, &Address::generate(&e), &token1, &jur);
    assert_eq!(client.get_token_address(), token1);

    client.set_token_address(&admin, &token2);
    assert_eq!(client.get_token_address(), token2);
}

#[test]
#[should_panic(expected = "Unauthorized: not admin")]
fn test_set_token_address_unauthorized_fails() {
    let e = Env::default();
    e.mock_all_auths();

    let admin = Address::generate(&e);
    let impostor = Address::generate(&e);
    let contract_id = e.register(ComplianceContract, ());
    let client = ComplianceContractClient::new(&e, &contract_id);
    let token = Address::generate(&e);
    let jur = Jurisdiction::GLOBAL;
    client.initialize(&admin, &Address::generate(&e), &token, &jur);

    let client2 = ComplianceContractClient::new(&e, &contract_id);
    client2.set_token_address(&impostor, &Address::generate(&e));
}

#[test]
fn test_set_default_jurisdiction_success() {
    let e = Env::default();
    e.mock_all_auths();

    let admin = Address::generate(&e);
    let contract_id = e.register(ComplianceContract, ());
    let client = ComplianceContractClient::new(&e, &contract_id);
    let token = Address::generate(&e);
    let jur = Jurisdiction::GLOBAL;

    client.initialize(&admin, &Address::generate(&e), &token, &jur);
    assert_eq!(client.get_default_jurisdiction(), Jurisdiction::GLOBAL);

    let new_jur = Jurisdiction::US;
    client.set_default_jurisdiction(&admin, &new_jur);
    assert_eq!(client.get_default_jurisdiction(), Jurisdiction::US);
}

#[test]
fn test_blacklist_flow() {
    let e = Env::default();
    e.mock_all_auths();

    let admin = Address::generate(&e);
    let user = Address::generate(&e);
    let contract_id = e.register(ComplianceContract, ());
    let client = ComplianceContractClient::new(&e, &contract_id);
    let token = Address::generate(&e);
    let jur = Jurisdiction::GLOBAL;

    client.initialize(&admin, &Address::generate(&e), &token, &jur);

    // blacklist
    let banned_true = true;
    client.set_blacklist(&admin, &user, &banned_true);
    assert!(client.is_blacklisted(&user));

    // un-blacklist
    let banned_false = false;
    client.set_blacklist(&admin, &user, &banned_false);
    assert!(!client.is_blacklisted(&user));
    assert!(!client.is_blacklisted(&user));
    // require_not_blacklisted should not panic
    let client2 = ComplianceContractClient::new(&e, &contract_id);
    client2.require_not_blacklisted(&user);
}

#[test]
#[should_panic(expected = "Address is blacklisted")]
fn test_require_not_blacklisted_panics_on_blacklisted() {
    let e = Env::default();
    e.mock_all_auths();

    let admin = Address::generate(&e);
    let user = Address::generate(&e);
    let contract_id = e.register(ComplianceContract, ());
    let client = ComplianceContractClient::new(&e, &contract_id);
    let token = Address::generate(&e);
    let jur = Jurisdiction::GLOBAL;
    client.initialize(&admin, &Address::generate(&e), &token, &jur);
    let banned = true;
    client.set_blacklist(&admin, &user, &banned);
    client.require_not_blacklisted(&user);
}

#[test]
#[should_panic(expected = "Unauthorized: not admin")]
fn test_blacklist_unauthorized_fails() {
    let e = Env::default();
    e.mock_all_auths();

    let admin = Address::generate(&e);
    let impostor = Address::generate(&e);
    let user = Address::generate(&e);
    let contract_id = e.register(ComplianceContract, ());
    let client = ComplianceContractClient::new(&e, &contract_id);
    let token = Address::generate(&e);
    let jur = Jurisdiction::GLOBAL;
    client.initialize(&admin, &Address::generate(&e), &token, &jur);

    let banned = true;
    let client2 = ComplianceContractClient::new(&e, &contract_id);
    client2.set_blacklist(&impostor, &user, &banned);
}

#[test]
fn test_blacklist_event_emitted() {
    let e = Env::default();
    e.mock_all_auths();

    let admin = Address::generate(&e);
    let user = Address::generate(&e);
    let contract_id = e.register(ComplianceContract, ());
    let client = ComplianceContractClient::new(&e, &contract_id);
    let token = Address::generate(&e);
    let jur = Jurisdiction::GLOBAL;
    client.initialize(&admin, &Address::generate(&e), &token, &jur);

    let banned = true;
    client.set_blacklist(&admin, &user, &banned);

    let events = e.events().all();
    let last_event = events.last().expect("Event should be emitted");
    let topic0: Symbol = last_event.1.get(0).unwrap().into_val(&e);
    let topic1: Address = last_event.1.get(1).unwrap().into_val(&e);
    assert_eq!(topic0, BLACKLIST_UPDATED);
    assert_eq!(topic1, admin);

    let val: (Address, bool) = last_event.2.into_val(&e);
    assert_eq!(val.0, user);
    assert_eq!(val.1, true);
}

// --- Clawback Tests ---

#[test]
fn test_clawback_executes_successfully() {
    let e = Env::default();
    e.mock_all_auths();

    let admin = Address::generate(&e);
    let clawback_admin = Address::generate(&e);
    let from_user = Address::generate(&e);
    let amount = 500i128;

    // Deploy MockToken
    let token_id = e.register(MockToken, ());
    let token_client = MockTokenClient::new(&e, &token_id);
    token_client.initialize(&admin, &clawback_admin);
    token_client.set_balance(&admin, &from_user, &amount);
    token_client.set_supply(&admin, &5000i128);

    // Deploy Compliance
    let contract_id = e.register(ComplianceContract, ());
    let client = ComplianceContractClient::new(&e, &contract_id);
    let jur = Jurisdiction::US;
    client.initialize(&admin, &clawback_admin, &token_id, &jur);

    // Pre-checks
    assert_eq!(token_client.get_balance(&from_user), amount);
    assert_eq!(token_client.get_supply(), 5000);

    // Execute clawback
    let reason = ClawbackReason::Fraud;
    let jurisdiction = Some(Jurisdiction::US);
    let legal_ref: Option<String> = None;
    let notes: Option<String> = None;
    client.clawback(
        &clawback_admin,
        &from_user,
        &amount,
        &reason,
        &jurisdiction,
        &legal_ref,
        &notes,
    );

    // Verify token effects
    assert_eq!(token_client.get_balance(&from_user), 0);
    assert_eq!(token_client.get_supply(), 4500);

    // Verify compliance record
    let count = client.get_clawback_count();
    assert_eq!(count, 1);
    let rec_id = 1u64;
    let record = client.get_clawback_record(&rec_id).unwrap();
    assert_eq!(record.from, from_user);
    assert_eq!(record.amount, amount);
    assert_eq!(record.reason, ClawbackReason::Fraud);
    assert_eq!(record.jurisdiction, Jurisdiction::US);
    assert_eq!(record.executed_by, clawback_admin);
    assert_eq!(record.legal_reference, None);
    assert_eq!(record.notes, None);
}

#[test]
#[should_panic(expected = "Unauthorized: not clawback admin")]
fn test_clawback_unauthorized_caller_fails() {
    let e = Env::default();
    e.mock_all_auths();

    let admin = Address::generate(&e);
    let clawback_admin = Address::generate(&e);
    let impostor = Address::generate(&e);
    let from_user = Address::generate(&e);
    let token_id = e.register(MockToken, ());
    let token_client = MockTokenClient::new(&e, &token_id);
    token_client.initialize(&admin, &clawback_admin);
    token_client.set_balance(&admin, &from_user, &100i128);
    token_client.set_supply(&admin, &1000i128);

    let contract_id = e.register(ComplianceContract, ());
    let client = ComplianceContractClient::new(&e, &contract_id);
    let jur = Jurisdiction::GLOBAL;
    client.initialize(&admin, &clawback_admin, &token_id, &jur);

    let amount = 50i128;
    let reason = ClawbackReason::Sanctions;
    let jurisdiction: Option<Jurisdiction> = None;
    let legal_ref: Option<String> = None;
    let notes: Option<String> = None;

    let client2 = ComplianceContractClient::new(&e, &contract_id);
    client2.clawback(
        &impostor,
        &from_user,
        &amount,
        &reason,
        &jurisdiction,
        &legal_ref,
        &notes,
    );
}

#[test]
#[should_panic(expected = "amount must be positive")]
fn test_clawback_zero_amount_fails() {
    let e = Env::default();
    e.mock_all_auths();

    let admin = Address::generate(&e);
    let clawback_admin = Address::generate(&e);
    let from_user = Address::generate(&e);
    let token_id = e.register(MockToken, ());
    let token_client = MockTokenClient::new(&e, &token_id);
    token_client.initialize(&admin, &clawback_admin);
    token_client.set_balance(&admin, &from_user, &100i128);
    token_client.set_supply(&admin, &1000i128);

    let contract_id = e.register(ComplianceContract, ());
    let client = ComplianceContractClient::new(&e, &contract_id);
    let jur = Jurisdiction::GLOBAL;
    client.initialize(&admin, &clawback_admin, &token_id, &jur);

    let amount = 0i128;
    let reason = ClawbackReason::Other;
    let jurisdiction: Option<Jurisdiction> = None;
    let legal_ref: Option<String> = None;
    let notes: Option<String> = None;
    client.clawback(
        &clawback_admin,
        &from_user,
        &amount,
        &reason,
        &jurisdiction,
        &legal_ref,
        &notes,
    );
}

#[test]
#[should_panic(expected = "insufficient balance")]
fn test_clawback_insufficient_balance_fails() {
    let e = Env::default();
    e.mock_all_auths();

    let admin = Address::generate(&e);
    let clawback_admin = Address::generate(&e);
    let from_user = Address::generate(&e);
    let token_id = e.register(MockToken, ());
    let token_client = MockTokenClient::new(&e, &token_id);
    token_client.initialize(&admin, &clawback_admin);
    token_client.set_balance(&admin, &from_user, &50i128);
    token_client.set_supply(&admin, &1000i128);

    let contract_id = e.register(ComplianceContract, ());
    let client = ComplianceContractClient::new(&e, &contract_id);
    let jur = Jurisdiction::GLOBAL;
    client.initialize(&admin, &clawback_admin, &token_id, &jur);

    let amount = 100i128;
    let reason = ClawbackReason::Other;
    let jurisdiction: Option<Jurisdiction> = None;
    let legal_ref: Option<String> = None;
    let notes: Option<String> = None;
    client.clawback(
        &clawback_admin,
        &from_user,
        &amount,
        &reason,
        &jurisdiction,
        &legal_ref,
        &notes,
    );
}

#[test]
fn test_clawback_record_stored_and_retrievable() {
    let e = Env::default();
    e.mock_all_auths();

    let admin = Address::generate(&e);
    let clawback_admin = Address::generate(&e);
    let from_user = Address::generate(&e);
    let token_id = e.register(MockToken, ());
    let token_client = MockTokenClient::new(&e, &token_id);
    token_client.initialize(&admin, &clawback_admin);
    token_client.set_balance(&admin, &from_user, &300i128);
    token_client.set_supply(&admin, &3000i128);

    let contract_id = e.register(ComplianceContract, ());
    let client = ComplianceContractClient::new(&e, &contract_id);
    let jur = Jurisdiction::EU;
    client.initialize(&admin, &clawback_admin, &token_id, &jur);

    // First clawback
    let reason1 = ClawbackReason::Fraud;
    let jurisdiction1 = Some(Jurisdiction::EU);
    let legal_ref1 = Some(String::from_str(&e, "First seizure"));
    let notes1: Option<String> = None;
    client.clawback(
        &clawback_admin,
        &from_user,
        &100i128,
        &reason1,
        &jurisdiction1,
        &legal_ref1,
        &notes1,
    );

    // Second clawback
    let reason2 = ClawbackReason::Sanctions;
    let jurisdiction2: Option<Jurisdiction> = None; // default EU
    let legal_ref2 = Some(String::from_str(&e, "Case #12345"));
    let notes2: Option<String> = None;
    client.clawback(
        &clawback_admin,
        &from_user,
        &100i128,
        &reason2,
        &jurisdiction2,
        &legal_ref2,
        &notes2,
    );

    let count = client.get_clawback_count();
    assert_eq!(count, 2);

    let rec_id1 = 1u64;
    let rec1 = client.get_clawback_record(&rec_id1).unwrap();
    assert_eq!(rec1.amount, 100);
    assert_eq!(rec1.reason, ClawbackReason::Fraud);
    assert_eq!(rec1.jurisdiction, Jurisdiction::EU);
    assert_eq!(rec1.legal_reference, Some(String::from_str(&e, "First seizure")));
    assert_eq!(rec1.notes, None);

    let rec_id2 = 2u64;
    let rec2 = client.get_clawback_record(&rec_id2).unwrap();
    assert_eq!(rec2.reason, ClawbackReason::Sanctions);
    assert_eq!(rec2.jurisdiction, Jurisdiction::EU);
    assert_eq!(rec2.legal_reference, Some(String::from_str(&e, "Case #12345")));

    let limit = 1u32;
    let recent = client.get_recent_clawbacks(&limit);
    assert_eq!(recent.len(), 1);
    assert_eq!(recent.get(0).unwrap().id, 2);

    let limit10 = 10u32;
    let offset0 = 0u32;
    let history = client.get_clawbacks_for_address(&from_user, &limit10, &offset0);
    assert_eq!(history.len(), 2);
    assert_eq!(history.get(0).unwrap().id, 2);
    assert_eq!(history.get(1).unwrap().id, 1);

    // Pagination: offset 1, limit 1 -> second record (id=1)
    let limit1 = 1u32;
    let offset1 = 1u32;
    let page = client.get_clawbacks_for_address(&from_user, &limit1, &offset1);
    assert_eq!(page.len(), 1);
    assert_eq!(page.get(0).unwrap().id, 1);
}

#[test]
fn test_clawback_event_emitted() {
    let e = Env::default();
    e.mock_all_auths();

    let admin = Address::generate(&e);
    let clawback_admin = Address::generate(&e);
    let from_user = Address::generate(&e);
    let token_id = e.register(MockToken, ());
    let token_client = MockTokenClient::new(&e, &token_id);
    token_client.initialize(&admin, &clawback_admin);
    token_client.set_balance(&admin, &from_user, &100i128);
    token_client.set_supply(&admin, &1000i128);

    let contract_id = e.register(ComplianceContract, ());
    let client = ComplianceContractClient::new(&e, &contract_id);
    let jur = Jurisdiction::GLOBAL;
    client.initialize(&admin, &clawback_admin, &token_id, &jur);

    let reason = ClawbackReason::Fraud;
    let jurisdiction = Some(Jurisdiction::US);
    let legal_ref = Some(String::from_str(&e, "Ref-001"));
    let notes = Some(String::from_str(&e, "Test note"));
    client.clawback(
        &clawback_admin,
        &from_user,
        &50i128,
        &reason,
        &jurisdiction,
        &legal_ref,
        &notes,
    );

    let events = e.events().all();
    let event = events.iter().find(|ev| {
        let topic0: Symbol = ev.1.get(0).unwrap().into_val(&e);
        topic0 == CLAWBACK_TOPIC
    }).expect("Clawback event missing");
    let topics = &event.1;
    let data = &event.2;
    assert_eq!(topics.len(), 3);
    let executor: Address = topics.get(1).unwrap().into_val(&e);
    let target: Address = topics.get(2).unwrap().into_val(&e);
    assert_eq!(executor, clawback_admin);
    assert_eq!(target, from_user);

    let (amount, reason_str, jurisdiction_str, lr, n, ts): (i128, String, String, Option<String>, Option<String>, u64) = data.into_val(&e);
    assert_eq!(amount, 50);
    assert_eq!(reason_str, String::from_str(&e, "fraud"));
    assert_eq!(jurisdiction_str, String::from_str(&e, "US"));
    assert_eq!(lr, Some(String::from_str(&e, "Ref-001")));
    assert_eq!(n, Some(String::from_str(&e, "Test note")));
}

#[test]
fn test_clawback_uses_default_jurisdiction_when_none() {
    let e = Env::default();
    e.mock_all_auths();

    let admin = Address::generate(&e);
    let clawback_admin = Address::generate(&e);
    let from_user = Address::generate(&e);
    let token_id = e.register(MockToken, ());
    let token_client = MockTokenClient::new(&e, &token_id);
    token_client.initialize(&admin, &clawback_admin);
    token_client.set_balance(&admin, &from_user, &30i128);
    token_client.set_supply(&admin, &300i128);

    let contract_id = e.register(ComplianceContract, ());
    let client = ComplianceContractClient::new(&e, &contract_id);
    let jur = Jurisdiction::GLOBAL;
    client.initialize(&admin, &clawback_admin, &token_id, &jur);

    let reason = ClawbackReason::Other;
    let jurisdiction: Option<Jurisdiction> = None;
    let legal_ref: Option<String> = None;
    let notes: Option<String> = None;
    client.clawback(
        &clawback_admin,
        &from_user,
        &10i128,
        &reason,
        &jurisdiction,
        &legal_ref,
        &notes,
    );

    let rec_id = 1u64;
    let record = client.get_clawback_record(&rec_id).unwrap();
    assert_eq!(record.jurisdiction, Jurisdiction::GLOBAL);
}

#[test]
fn test_get_clawbacks_for_address_pagination() {
    let e = Env::default();
    e.mock_all_auths();

    let admin = Address::generate(&e);
    let clawback_admin = Address::generate(&e);
    let user_a = Address::generate(&e);
    let user_b = Address::generate(&e);
    let token_id = e.register(MockToken, ());
    let token_client = MockTokenClient::new(&e, &token_id);
    token_client.initialize(&admin, &clawback_admin);
    token_client.set_balance(&admin, &user_a, &1000i128);
    token_client.set_balance(&admin, &user_b, &1000i128);
    token_client.set_supply(&admin, &10000i128);

    let contract_id = e.register(ComplianceContract, ());
    let client = ComplianceContractClient::new(&e, &contract_id);
    let jur = Jurisdiction::GLOBAL;
    client.initialize(&admin, &clawback_admin, &token_id, &jur);

    // 5 clawbacks for user_a
    for _ in 0..5 {
        client.clawback(
            &clawback_admin,
            &user_a,
            &10i128,
            &ClawbackReason::Fraud,
            &None::<Jurisdiction>,
            &None::<String>,
            &None::<String>,
        );
    }
    // 2 clawbacks for user_b
    for _ in 0..2 {
        client.clawback(
            &clawback_admin,
            &user_b,
            &20i128,
            &ClawbackReason::Sanctions,
            &None::<Jurisdiction>,
            &None::<String>,
            &None::<String>,
        );
    }

    let count = client.get_clawback_count();
    assert_eq!(count, 7);

    let limit_a = 5u32;
    let offset0 = 0u32;
    let hist_a = client.get_clawbacks_for_address(&user_a, &limit_a, &offset0);
    assert_eq!(hist_a.len(), 5);
    for (i, rec) in hist_a.iter().enumerate() {
        assert_eq!(rec.id, 5 - i as u64);
        assert_eq!(rec.from, user_a);
    }

    let limit_b = 10u32;
    let hist_b = client.get_clawbacks_for_address(&user_b, &limit_b, &offset0);
    assert_eq!(hist_b.len(), 2);
    assert_eq!(hist_b.get(0).unwrap().id, 7);
    assert_eq!(hist_b.get(1).unwrap().id, 6);

    // Pagination: offset 1, limit 1 -> record id=4
    let limit1 = 1u32;
    let offset1 = 1u32;
    let page = client.get_clawbacks_for_address(&user_a, &limit1, &offset1);
    assert_eq!(page.len(), 1);
    assert_eq!(page.get(0).unwrap().id, 4);
}

#[test]
fn test_clawback_event_topic_order() {
    let e = Env::default();
    e.mock_all_auths();

    let admin = Address::generate(&e);
    let clawback_admin = Address::generate(&e);
    let from_user = Address::generate(&e);
    let token_id = e.register(MockToken, ());
    let token_client = MockTokenClient::new(&e, &token_id);
    token_client.initialize(&admin, &clawback_admin);
    token_client.set_balance(&admin, &from_user, &75i128);
    token_client.set_supply(&admin, &750i128);

    let contract_id = e.register(ComplianceContract, ());
    let client = ComplianceContractClient::new(&e, &contract_id);
    let jur = Jurisdiction::SG;
    client.initialize(&admin, &clawback_admin, &token_id, &jur);

    let reason = ClawbackReason::Regulatory;
    let jurisdiction = Some(Jurisdiction::SG);
    let legal_ref = Some(String::from_str(&e, "Ref-123"));
    let notes = Some(String::from_str(&e, "Note"));
    client.clawback(
        &clawback_admin,
        &from_user,
        &25i128,
        &reason,
        &jurisdiction,
        &legal_ref,
        &notes,
    );

    let events = e.events().all();
    let event = events.iter().find(|ev| {
        let topic0: Symbol = ev.1.get(0).unwrap().into_val(&e);
        topic0 == CLAWBACK_TOPIC
    }).expect("Clawback event missing");
    let topics = &event.1;
    let data = &event.2;
    assert_eq!(topics.len(), 3);
    let executor: Address = topics.get(1).unwrap().into_val(&e);
    let target: Address = topics.get(2).unwrap().into_val(&e);
    assert_eq!(executor, clawback_admin);
    assert_eq!(target, from_user);
}

// --- Version/Status tests ---

#[test]
fn test_version_returns_expected() {
    let e = Env::default();
    let id = e.register(ComplianceContract, ());
    let client = ComplianceContractClient::new(&e, &id);
    assert_eq!(client.version(), soroban_sdk::String::from_str(&e, "1.0.0"));
}

#[test]
fn test_status_returns_alive() {
    let e = Env::default();
    let id = e.register(ComplianceContract, ());
    let client = ComplianceContractClient::new(&e, &id);
    assert_eq!(client.status(), soroban_sdk::String::from_str(&e, "alive"));
}

#[test]
fn test_version_idempotent() {
    let e = Env::default();
    let id = e.register(ComplianceContract, ());
    let client = ComplianceContractClient::new(&e, &id);
    assert_eq!(client.version(), client.version());
}

#[test]
fn test_status_idempotent() {
    let e = Env::default();
    let id = e.register(ComplianceContract, ());
    let client = ComplianceContractClient::new(&e, &id);
    assert_eq!(client.status(), client.status());
}

// --- Property Tests ---

use proptest::prelude::*;

proptest! {
    #[test]
    fn prop_version_idempotent(_seed: u64) {
        let e = Env::default();
        let id = e.register(ComplianceContract, ());
        let client = ComplianceContractClient::new(&e, &id);
        prop_assert_eq!(client.version(), client.version());
    }

    #[test]
    fn prop_status_idempotent(_seed: u64) {
        let e = Env::default();
        let id = e.register(ComplianceContract, ());
        let client = ComplianceContractClient::new(&e, &id);
        prop_assert_eq!(client.status(), client.status());
    }

    #[test]
    fn prop_version_semver_format(_seed: u64) {
        let e = Env::default();
        let id = e.register(ComplianceContract, ());
        let client = ComplianceContractClient::new(&e, &id);
        let v = client.version();
        let mut buf = [0u8; 32];
        let len = v.len() as usize;
        v.copy_into_slice(&mut buf[..len]);
        let dot_count = buf[..len].iter().filter(|&&b| b == b'.').count();
        prop_assert_eq!(dot_count, 2);
        for &b in &buf[..len] {
            prop_assert!(b == b'.' || b.is_ascii_digit());
        }
    }

    #[test]
    fn prop_status_is_alive(_seed: u64) {
        let e = Env::default();
        let id = e.register(ComplianceContract, ());
        let client = ComplianceContractClient::new(&e, &id);
        prop_assert_eq!(client.status(), soroban_sdk::String::from_str(&e, "alive"));
    }

    #[test]
    fn prop_no_auth_required(_seed: u64) {
        let e = Env::default();
        // Intentionally no e.mock_all_auths()
        let id = e.register(ComplianceContract, ());
        let client = ComplianceContractClient::new(&e, &id);
        let _ = client.version();
        let _ = client.status();
    }
}
