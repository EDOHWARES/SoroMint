#![cfg(test)]

use super::*;
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    token, Address, Env, String,
};

fn create_token_contract<'a>(e: &Env, admin: &Address) -> (Address, token::StellarAssetClient<'a>) {
    let contract_address = e.register_stellar_asset_contract_v2(admin.clone());
    (
        contract_address.clone(),
        token::StellarAssetClient::new(e, &contract_address),
    )
}

fn create_wrapper_contract<'a>(e: &Env) -> WrapperTokenClient<'a> {
    WrapperTokenClient::new(e, &e.register(WrapperToken, ()))
}

#[test]
fn test_initialize() {
    let e = Env::default();
    e.mock_all_auths();

    let admin = Address::generate(&e);
    let (underlying_token_id, _) = create_token_contract(&e, &admin);
    let wrapper = create_wrapper_contract(&e);

    wrapper.initialize(
        &admin,
        &underlying_token_id,
        &7,
        &String::from_str(&e, "Wrapped XLM"),
        &String::from_str(&e, "wXLM"),
    );

    assert_eq!(wrapper.name(), String::from_str(&e, "Wrapped XLM"));
    assert_eq!(wrapper.symbol(), String::from_str(&e, "wXLM"));
    assert_eq!(wrapper.decimals(), 7);
    assert_eq!(wrapper.supply(), 0);
    assert_eq!(wrapper.underlying_token(), underlying_token_id);
}

#[test]
fn test_wrap_and_unwrap() {
    let e = Env::default();
    e.mock_all_auths();

    let admin = Address::generate(&e);
    let user = Address::generate(&e);
    let (underlying_token_id, underlying_token) = create_token_contract(&e, &admin);
    let wrapper = create_wrapper_contract(&e);

    // Initialize wrapper
    wrapper.initialize(
        &admin,
        &underlying_token_id,
        &7,
        &String::from_str(&e, "Wrapped XLM"),
        &String::from_str(&e, "wXLM"),
    );

    // Mint underlying tokens to user
    underlying_token.mint(&user, &1000);
    assert_eq!(underlying_token.balance(&user), 1000);

    // Wrap tokens
    wrapper.wrap(&user, &500);
    assert_eq!(wrapper.balance(&user), 500);
    assert_eq!(wrapper.supply(), 500);
    assert_eq!(underlying_token.balance(&user), 500);

    // Unwrap tokens
    wrapper.unwrap(&user, &200);
    assert_eq!(wrapper.balance(&user), 300);
    assert_eq!(wrapper.supply(), 300);
    assert_eq!(underlying_token.balance(&user), 700);
}

#[test]
fn test_transfer_with_fees() {
    let e = Env::default();
    e.mock_all_auths();

    let admin = Address::generate(&e);
    let user1 = Address::generate(&e);
    let user2 = Address::generate(&e);
    let treasury = Address::generate(&e);
    let (underlying_token_id, underlying_token) = create_token_contract(&e, &admin);
    let wrapper = create_wrapper_contract(&e);

    // Initialize
    wrapper.initialize(
        &admin,
        &underlying_token_id,
        &7,
        &String::from_str(&e, "Wrapped XLM"),
        &String::from_str(&e, "wXLM"),
    );

    // Set 1% fee
    wrapper.set_fee_config(&true, &100, &treasury);

    // Mint and wrap
    underlying_token.mint(&user1, &1000);
    wrapper.wrap(&user1, &1000);

    // Transfer with fee
    wrapper.transfer(&user1, &user2, &100);

    // user2 receives 99 (100 - 1% fee)
    // treasury receives 1
    assert_eq!(wrapper.balance(&user1), 900);
    assert_eq!(wrapper.balance(&user2), 99);
    assert_eq!(wrapper.balance(&treasury), 1);
}

#[test]
#[should_panic(expected = "wrap amount must be positive")]
fn test_wrap_zero_amount() {
    let e = Env::default();
    e.mock_all_auths();

    let admin = Address::generate(&e);
    let user = Address::generate(&e);
    let (underlying_token_id, _) = create_token_contract(&e, &admin);
    let wrapper = create_wrapper_contract(&e);

    wrapper.initialize(
        &admin,
        &underlying_token_id,
        &7,
        &String::from_str(&e, "Wrapped XLM"),
        &String::from_str(&e, "wXLM"),
    );

    wrapper.wrap(&user, &0);
}

#[test]
#[should_panic(expected = "insufficient balance")]
fn test_unwrap_insufficient_balance() {
    let e = Env::default();
    e.mock_all_auths();

    let admin = Address::generate(&e);
    let user = Address::generate(&e);
    let (underlying_token_id, underlying_token) = create_token_contract(&e, &admin);
    let wrapper = create_wrapper_contract(&e);

    wrapper.initialize(
        &admin,
        &underlying_token_id,
        &7,
        &String::from_str(&e, "Wrapped XLM"),
        &String::from_str(&e, "wXLM"),
    );

    underlying_token.mint(&user, &100);
    wrapper.wrap(&user, &100);
    wrapper.unwrap(&user, &200); // Try to unwrap more than wrapped
}
