#![cfg(test)]

use super::*;
use soroban_sdk::{
    testutils::{Address as _, Ledger, LedgerInfo},
    token, Address, Env,
};

fn create_token_contract<'a>(e: &Env, admin: &Address) -> (Address, token::Client<'a>) {
    let contract_id = e.register_stellar_asset_contract_v2(admin.clone());
    (contract_id.clone(), token::Client::new(e, &contract_id))
}

#[test]
fn test_initialize() {
    let e = Env::default();
    let admin = Address::generate(&e);

    let contract_id = e.register(OTCEscrow, ());
    let client = OTCEscrowClient::new(&e, &contract_id);

    client.initialize(&admin);

    // Should panic on second initialization
    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        client.initialize(&admin);
    }));
    assert!(result.is_err());
}

#[test]
fn test_create_trade() {
    let e = Env::default();
    e.mock_all_auths();

    let admin = Address::generate(&e);
    let maker = Address::generate(&e);

    let contract_id = e.register(OTCEscrow, ());
    let client = OTCEscrowClient::new(&e, &contract_id);

    client.initialize(&admin);

    // Create tokens
    let (token_a_id, token_a) = create_token_contract(&e, &admin);
    let (token_b_id, token_b) = create_token_contract(&e, &admin);

    // Mint tokens to maker
    token_a.mint(&maker, &1000);

    // Create trade
    let trade_id = client.create_trade(&maker, &token_a_id, &100, &token_b_id, &200, &1000);

    assert_eq!(trade_id, 1);

    // Verify trade details
    let trade = client.get_trade(&trade_id);
    assert_eq!(trade.maker, maker);
    assert_eq!(trade.maker_token, token_a_id);
    assert_eq!(trade.maker_amount, 100);
    assert_eq!(trade.taker_token, token_b_id);
    assert_eq!(trade.taker_amount, 200);
    assert_eq!(trade.status, TradeStatus::Pending);

    // Verify tokens transferred to escrow
    assert_eq!(token_a.balance(&maker), 900);
    assert_eq!(token_a.balance(&contract_id), 100);
}

#[test]
fn test_accept_trade() {
    let e = Env::default();
    e.mock_all_auths();

    let admin = Address::generate(&e);
    let maker = Address::generate(&e);
    let taker = Address::generate(&e);

    let contract_id = e.register(OTCEscrow, ());
    let client = OTCEscrowClient::new(&e, &contract_id);

    client.initialize(&admin);

    // Create tokens
    let (token_a_id, token_a) = create_token_contract(&e, &admin);
    let (token_b_id, token_b) = create_token_contract(&e, &admin);

    // Mint tokens
    token_a.mint(&maker, &1000);
    token_b.mint(&taker, &2000);

    // Create trade
    let trade_id = client.create_trade(&maker, &token_a_id, &100, &token_b_id, &200, &1000);

    // Accept trade
    client.accept_trade(&trade_id, &taker);

    // Verify trade completed
    let trade = client.get_trade(&trade_id);
    assert_eq!(trade.status, TradeStatus::Completed);
    assert_eq!(trade.taker, Some(taker.clone()));

    // Verify token balances after swap
    assert_eq!(token_a.balance(&maker), 900); // Maker had 1000, sent 100
    assert_eq!(token_a.balance(&taker), 100); // Taker received 100
    assert_eq!(token_a.balance(&contract_id), 0); // Escrow empty

    assert_eq!(token_b.balance(&maker), 200); // Maker received 200
    assert_eq!(token_b.balance(&taker), 1800); // Taker had 2000, sent 200
}

#[test]
fn test_cancel_trade() {
    let e = Env::default();
    e.mock_all_auths();

    let admin = Address::generate(&e);
    let maker = Address::generate(&e);

    let contract_id = e.register(OTCEscrow, ());
    let client = OTCEscrowClient::new(&e, &contract_id);

    client.initialize(&admin);

    // Create tokens
    let (token_a_id, token_a) = create_token_contract(&e, &admin);
    let (token_b_id, _) = create_token_contract(&e, &admin);

    // Mint tokens to maker
    token_a.mint(&maker, &1000);

    // Create trade
    let trade_id = client.create_trade(&maker, &token_a_id, &100, &token_b_id, &200, &1000);

    // Cancel trade
    client.cancel_trade(&trade_id);

    // Verify trade cancelled
    let trade = client.get_trade(&trade_id);
    assert_eq!(trade.status, TradeStatus::Cancelled);

    // Verify tokens refunded
    assert_eq!(token_a.balance(&maker), 1000);
    assert_eq!(token_a.balance(&contract_id), 0);
}

#[test]
fn test_claim_expired() {
    let e = Env::default();
    e.mock_all_auths();

    let admin = Address::generate(&e);
    let maker = Address::generate(&e);

    let contract_id = e.register(OTCEscrow, ());
    let client = OTCEscrowClient::new(&e, &contract_id);

    client.initialize(&admin);

    // Create tokens
    let (token_a_id, token_a) = create_token_contract(&e, &admin);
    let (token_b_id, _) = create_token_contract(&e, &admin);

    // Mint tokens to maker
    token_a.mint(&maker, &1000);

    // Set initial ledger
    e.ledger().set(LedgerInfo {
        timestamp: 1000,
        protocol_version: 20,
        sequence_number: 100,
        network_id: Default::default(),
        base_reserve: 10,
        min_temp_entry_ttl: 10,
        min_persistent_entry_ttl: 10,
        max_entry_ttl: 3110400,
    });

    // Create trade with 50 ledger expiration
    let trade_id = client.create_trade(&maker, &token_a_id, &100, &token_b_id, &200, &50);

    // Advance ledger past expiration
    e.ledger().set(LedgerInfo {
        timestamp: 2000,
        protocol_version: 20,
        sequence_number: 151,
        network_id: Default::default(),
        base_reserve: 10,
        min_temp_entry_ttl: 10,
        min_persistent_entry_ttl: 10,
        max_entry_ttl: 3110400,
    });

    // Claim expired trade
    client.claim_expired(&trade_id);

    // Verify trade expired
    let trade = client.get_trade(&trade_id);
    assert_eq!(trade.status, TradeStatus::Expired);

    // Verify tokens refunded
    assert_eq!(token_a.balance(&maker), 1000);
    assert_eq!(token_a.balance(&contract_id), 0);
}

#[test]
fn test_is_active() {
    let e = Env::default();
    e.mock_all_auths();

    let admin = Address::generate(&e);
    let maker = Address::generate(&e);

    let contract_id = e.register(OTCEscrow, ());
    let client = OTCEscrowClient::new(&e, &contract_id);

    client.initialize(&admin);

    // Create tokens
    let (token_a_id, token_a) = create_token_contract(&e, &admin);
    let (token_b_id, _) = create_token_contract(&e, &admin);

    // Mint tokens to maker
    token_a.mint(&maker, &1000);

    // Create trade
    let trade_id = client.create_trade(&maker, &token_a_id, &100, &token_b_id, &200, &1000);

    // Should be active
    assert!(client.is_active(&trade_id));

    // Cancel trade
    client.cancel_trade(&trade_id);

    // Should not be active
    assert!(!client.is_active(&trade_id));
}

#[test]
#[should_panic(expected = "amounts must be positive")]
fn test_create_trade_zero_amount() {
    let e = Env::default();
    e.mock_all_auths();

    let admin = Address::generate(&e);
    let maker = Address::generate(&e);

    let contract_id = e.register(OTCEscrow, ());
    let client = OTCEscrowClient::new(&e, &contract_id);

    client.initialize(&admin);

    let (token_a_id, _) = create_token_contract(&e, &admin);
    let (token_b_id, _) = create_token_contract(&e, &admin);

    // Should panic with zero amount
    client.create_trade(&maker, &token_a_id, &0, &token_b_id, &200, &1000);
}

#[test]
#[should_panic(expected = "trade not pending")]
fn test_accept_completed_trade() {
    let e = Env::default();
    e.mock_all_auths();

    let admin = Address::generate(&e);
    let maker = Address::generate(&e);
    let taker = Address::generate(&e);

    let contract_id = e.register(OTCEscrow, ());
    let client = OTCEscrowClient::new(&e, &contract_id);

    client.initialize(&admin);

    let (token_a_id, token_a) = create_token_contract(&e, &admin);
    let (token_b_id, token_b) = create_token_contract(&e, &admin);

    token_a.mint(&maker, &1000);
    token_b.mint(&taker, &2000);

    let trade_id = client.create_trade(&maker, &token_a_id, &100, &token_b_id, &200, &1000);

    // Accept once
    client.accept_trade(&trade_id, &taker);

    // Should panic on second accept
    client.accept_trade(&trade_id, &taker);
}
