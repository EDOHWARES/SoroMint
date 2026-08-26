#![cfg(test)]

use super::*;
use proptest::prelude::*;
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

// --- Fuzz tests ---

proptest! {
    #[test]
    fn prop_initialize_accepts_valid_fee_rates(fee_bps in 0u32..=10_000) {
        let e = Env::default();
        e.mock_all_auths();
        let (admin, _, token_addr) = setup(&e);
        let contract_id = e.register(Backstop, ());
        let client = BackstopClient::new(&e, &contract_id);

        client.initialize(&admin, &token_addr, &fee_bps);

        prop_assert_eq!(client.get_fee_bps(), fee_bps);
        prop_assert_eq!(client.get_total_deposited(), 0);
        prop_assert_eq!(client.get_total_withdrawn(), 0);
    }

    #[test]
    fn prop_initialize_rejects_invalid_fee_rates(fee_bps in 10_001u32..=u32::MAX) {
        let e = Env::default();
        e.mock_all_auths();
        let (admin, _, token_addr) = setup(&e);
        let contract_id = e.register(Backstop, ());
        let client = BackstopClient::new(&e, &contract_id);

        prop_assert!(client.try_initialize(&admin, &token_addr, &fee_bps).is_err());

        // A rejected initialization must leave the contract usable.
        client.initialize(&admin, &token_addr, &0);
        prop_assert_eq!(client.get_fee_bps(), 0);
    }

    #[test]
    fn prop_calc_fee_matches_basis_points(
        fee_bps in 0u32..=10_000,
        principal in 0i128..=1_000_000_000i128,
    ) {
        let e = Env::default();
        e.mock_all_auths();
        let (admin, _, token_addr) = setup(&e);
        let contract_id = e.register(Backstop, ());
        let client = BackstopClient::new(&e, &contract_id);
        client.initialize(&admin, &token_addr, &fee_bps);

        let expected = principal * fee_bps as i128 / 10_000;
        prop_assert_eq!(client.calc_fee(&principal), expected);
    }

    #[test]
    fn prop_positive_deposits_preserve_token_and_total(
        amounts in prop::collection::vec(1i128..=1_000, 1..=8),
    ) {
        let e = Env::default();
        e.mock_all_auths();
        let (admin, depositor, token_addr) = setup(&e);
        let token = TokenClient::new(&e, &token_addr);
        let contract_id = e.register(Backstop, ());
        let client = BackstopClient::new(&e, &contract_id);
        client.initialize(&admin, &token_addr, &0);

        let expected_total: i128 = amounts.iter().sum();
        for amount in &amounts {
            client.deposit_fee(&depositor, amount);
        }

        prop_assert_eq!(client.get_total_deposited(), expected_total);
        prop_assert_eq!(token.balance(&contract_id), expected_total);
        prop_assert_eq!(token.balance(&depositor), 10_000 - expected_total);
    }

    #[test]
    fn prop_non_positive_deposits_are_rejected(amount in -10_000i128..=0) {
        let e = Env::default();
        e.mock_all_auths();
        let (admin, depositor, token_addr) = setup(&e);
        let token = TokenClient::new(&e, &token_addr);
        let contract_id = e.register(Backstop, ());
        let client = BackstopClient::new(&e, &contract_id);
        client.initialize(&admin, &token_addr, &0);

        prop_assert!(client.try_deposit_fee(&depositor, &amount).is_err());
        prop_assert_eq!(client.get_total_deposited(), 0);
        prop_assert_eq!(token.balance(&contract_id), 0);
        prop_assert_eq!(token.balance(&depositor), 10_000);
    }

    #[test]
    fn prop_valid_withdrawals_preserve_reserve(
        deposit_amount in 1i128..=10_000,
        requested_withdrawal in 1i128..=10_000,
    ) {
        let e = Env::default();
        e.mock_all_auths();
        let (admin, depositor, token_addr) = setup(&e);
        let token = TokenClient::new(&e, &token_addr);
        let contract_id = e.register(Backstop, ());
        let client = BackstopClient::new(&e, &contract_id);
        client.initialize(&admin, &token_addr, &0);
        client.deposit_fee(&depositor, &deposit_amount);

        let withdrawal = requested_withdrawal.min(deposit_amount);
        client.withdraw(&depositor, &withdrawal);

        prop_assert_eq!(client.get_total_withdrawn(), withdrawal);
        prop_assert_eq!(token.balance(&contract_id), deposit_amount - withdrawal);
        prop_assert_eq!(token.balance(&depositor), 10_000 - deposit_amount + withdrawal);
    }

    #[test]
    fn prop_invalid_withdrawals_do_not_change_state(
        deposit_amount in 1i128..=10_000,
        extra_amount in 1i128..=10_000,
    ) {
        let e = Env::default();
        e.mock_all_auths();
        let (admin, depositor, token_addr) = setup(&e);
        let token = TokenClient::new(&e, &token_addr);
        let contract_id = e.register(Backstop, ());
        let client = BackstopClient::new(&e, &contract_id);
        client.initialize(&admin, &token_addr, &0);
        client.deposit_fee(&depositor, &deposit_amount);

        let withdrawal = deposit_amount + extra_amount;
        prop_assert!(client.try_withdraw(&depositor, &withdrawal).is_err());
        prop_assert_eq!(client.get_total_withdrawn(), 0);
        prop_assert_eq!(token.balance(&contract_id), deposit_amount);
    }

    #[test]
    fn prop_set_fee_bps_accepts_valid_values(fee_bps in 0u32..=10_000) {
        let e = Env::default();
        e.mock_all_auths();
        let (admin, _, token_addr) = setup(&e);
        let contract_id = e.register(Backstop, ());
        let client = BackstopClient::new(&e, &contract_id);
        client.initialize(&admin, &token_addr, &100);

        client.set_fee_bps(&fee_bps);
        prop_assert_eq!(client.get_fee_bps(), fee_bps);
    }

    #[test]
    fn prop_set_fee_bps_rejects_values_above_limit(fee_bps in 10_001u32..=u32::MAX) {
        let e = Env::default();
        e.mock_all_auths();
        let (admin, _, token_addr) = setup(&e);
        let contract_id = e.register(Backstop, ());
        let client = BackstopClient::new(&e, &contract_id);
        client.initialize(&admin, &token_addr, &100);

        prop_assert!(client.try_set_fee_bps(&fee_bps).is_err());
        prop_assert_eq!(client.get_fee_bps(), 100);
    }
}
