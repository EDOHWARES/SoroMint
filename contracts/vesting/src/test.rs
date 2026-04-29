#![cfg(test)]

use super::*;
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    token::{Client as TokenClient, StellarAssetClient},
    vec, Address, Env,
};

fn setup_token(e: &Env, admin: &Address, amount: i128) -> Address {
    let token_id = e.register_stellar_asset_contract_v2(admin.clone());
    StellarAssetClient::new(e, &token_id.address()).mint(admin, &amount);
    token_id.address()
}

#[test]
fn test_linear_vesting() {
    let e = Env::default();
    e.mock_all_auths();
    e.ledger().set_timestamp(1000);

    let admin = Address::generate(&e);
    let beneficiary = Address::generate(&e);
    let token_addr = setup_token(&e, &admin, 1_000);
    let token = TokenClient::new(&e, &token_addr);

    let contract_id = e.register(Vesting, ());
    let client = VestingClient::new(&e, &contract_id);

    // start=1000, end=2000, total=1000
    client.init_linear(&admin, &token_addr, &beneficiary, &1_000i128, &1000u64, &2000u64);

    // At start: nothing vested
    assert_eq!(client.claimable(), 0);

    // At midpoint: 500 vested
    e.ledger().set_timestamp(1500);
    assert_eq!(client.claimable(), 500);

    // Claim 500
    let claimed = client.claim();
    assert_eq!(claimed, 500);
    assert_eq!(token.balance(&beneficiary), 500);

    // At end: remaining 500 vested
    e.ledger().set_timestamp(2000);
    assert_eq!(client.claimable(), 500);
    client.claim();
    assert_eq!(token.balance(&beneficiary), 1000);
}

#[test]
fn test_milestone_vesting() {
    let e = Env::default();
    e.mock_all_auths();

    let admin = Address::generate(&e);
    let beneficiary = Address::generate(&e);
    let token_addr = setup_token(&e, &admin, 900);
    let token = TokenClient::new(&e, &token_addr);

    let contract_id = e.register(Vesting, ());
    let client = VestingClient::new(&e, &contract_id);

    let milestones = vec![&e, 300i128, 300i128, 300i128];
    client.init_milestone(&admin, &token_addr, &beneficiary, &milestones);

    // Nothing released yet
    assert_eq!(client.claimable(), 0);

    // Release milestone 0
    client.release_milestone(&0u32);
    assert_eq!(client.claimable(), 300);
    client.claim();
    assert_eq!(token.balance(&beneficiary), 300);

    // Release milestones 1 and 2
    client.release_milestone(&1u32);
    client.release_milestone(&2u32);
    assert_eq!(client.claimable(), 600);
    client.claim();
    assert_eq!(token.balance(&beneficiary), 900);
}
