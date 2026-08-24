#![cfg(test)]

use super::*;
use soroban_sdk::{
    testutils::Address as _,
    token::{Client as TokenClient, StellarAssetClient},
    Address, Env,
};

fn setup(e: &Env) -> (Address, Address, Address) {
    let admin = Address::generate(e);
    let depositor = Address::generate(e);
    let token_id = e.register_stellar_asset_contract_v2(admin.clone());
    StellarAssetClient::new(e, &token_id.address()).mint(&depositor, &10_000);
    (admin, depositor, token_id.address())
}

#[test]
fn test_deposit_and_withdraw() {
    let e = Env::default();
    e.mock_all_auths();

    let (admin, depositor, token_addr) = setup(&e);
    let token = TokenClient::new(&e, &token_addr);

    let contract_id = e.register(Backstop, ());
    let client = BackstopClient::new(&e, &contract_id);

    client.initialize(&admin, &token_addr, &50u32); // 0.5%

    client.deposit_fee(&depositor, &1000i128);
    assert_eq!(client.get_total_deposited(), 1000);
    assert_eq!(token.balance(&contract_id), 1000);

    client.withdraw(&depositor, &400i128);
    assert_eq!(client.get_total_withdrawn(), 400);
    assert_eq!(token.balance(&contract_id), 600);
}

#[test]
fn test_calc_fee() {
    let e = Env::default();
    e.mock_all_auths();

    let (admin, _, token_addr) = setup(&e);
    let contract_id = e.register(Backstop, ());
    let client = BackstopClient::new(&e, &contract_id);

    client.initialize(&admin, &token_addr, &100u32); // 1%
    assert_eq!(client.calc_fee(&10_000i128), 100);
}

#[test]
fn test_get_config() {
    let e = Env::default();
    e.mock_all_auths();

    let (admin, depositor, token_addr) = setup(&e);

    let contract_id = e.register(Backstop, ());
    let client = BackstopClient::new(&e, &contract_id);

    client.initialize(&admin, &token_addr, &50u32);

    let config = client.get_config();
    assert_eq!(config.admin, admin);
    assert_eq!(config.token, token_addr);
    assert_eq!(config.fee_bps, 50u32);
    assert_eq!(config.total_deposited, 0);
    assert_eq!(config.total_withdrawn, 0);

    client.deposit_fee(&depositor, &500i128);

    let config = client.get_config();
    assert_eq!(config.total_deposited, 500);
    assert_eq!(config.total_withdrawn, 0);

    client.withdraw(&depositor, &200i128);

    let config = client.get_config();
    assert_eq!(config.total_deposited, 500);
    assert_eq!(config.total_withdrawn, 200);
}

#[test]
fn test_get_balance() {
    let e = Env::default();
    e.mock_all_auths();

    let (admin, depositor, token_addr) = setup(&e);
    let token = TokenClient::new(&e, &token_addr);

    let contract_id = e.register(Backstop, ());
    let client = BackstopClient::new(&e, &contract_id);

    client.initialize(&admin, &token_addr, &50u32);

    assert_eq!(client.get_balance(), 0);

    client.deposit_fee(&depositor, &750i128);
    assert_eq!(client.get_balance(), 750);
    assert_eq!(token.balance(&contract_id), 750);

    client.withdraw(&depositor, &250i128);
    assert_eq!(client.get_balance(), 500);
    assert_eq!(token.balance(&contract_id), 500);
}
