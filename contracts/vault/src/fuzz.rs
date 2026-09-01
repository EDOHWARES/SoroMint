#![cfg(test)]

extern crate std;

use super::*;
use soroban_sdk::{testutils::Address as _, Address, Env};

/// Fuzz `set_collateral_config` against randomized valid inputs.
/// Verifies the contract accepts any config that satisfies the invariants:
/// - `min_collateral_ratio` >= MIN_COLLATERAL_RATIO (15000)
/// - `liquidation_threshold` < `min_collateral_ratio`
/// - `liquidation_penalty` <= 10000
#[cfg(test)]
mod collateral_config_fuzz {
    use super::*;
    use proptest::prelude::*;

    fn env_client() -> (Env, VaultContractClient<'static>, Address) {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register_contract(None, VaultContract);
        let client = VaultContractClient::new(&env, &contract_id);
        let admin = Address::generate(&env);
        let smt_token = Address::generate(&env);
        let oracle = Address::generate(&env);
        client.initialize(&admin, &smt_token, &oracle);
        let collateral = Address::generate(&env);
        (env, client, collateral)
    }

    proptest! {
        #![proptest_config(ProptestConfig::with_cases(64))]

        #[test]
        fn fuzz_set_collateral_config_valid(
            min_ratio in MIN_COLLATERAL_RATIO..20000u32,
            liq_threshold in 10000u32..MIN_COLLATERAL_RATIO,
            penalty in 0u32..10001u32,
        ) {
            let (_env, client, collateral) = env_client();
            prop_assume!(liq_threshold < min_ratio);

            client.set_collateral_config(&collateral, &min_ratio, &liq_threshold, &penalty);
            prop_assert!(true);
        }
    }

    /// Explicit boundary panic tests for invalid collateral configs.
    #[test]
    #[should_panic(expected = "collateral ratio too low")]
    fn rejects_min_ratio_below_floor() {
        let (_env, client, collateral) = env_client();
        client.set_collateral_config(&collateral, &(MIN_COLLATERAL_RATIO - 1), &13000, &1000);
    }

    #[test]
    #[should_panic(expected = "liquidation threshold must be below min ratio")]
    fn rejects_liquidation_threshold_at_or_above_min_ratio() {
        let (_env, client, collateral) = env_client();
        client.set_collateral_config(&collateral, &15000, &15000, &1000);
    }
}

/// Fuzz `deposit_and_mint` against randomized valid collateral/debt amounts.
/// Invariants:
/// - Both amounts are positive.
/// - The resulting position satisfies the configured min collateral ratio.
/// - Successful calls create a vault position with the expected debt.
#[cfg(test)]
mod deposit_and_mint_fuzz {
    use super::*;
    use proptest::prelude::*;

    fn env_client_feeds() -> (
        Env,
        VaultContractClient<'static>,
        Address, // collateral token
        Address, // user
    ) {
        let env = Env::default();
        env.mock_all_auths();

        let push_id = env.register(crate::test::MockPriceFeed, ());
        let smt_id = env.register(crate::test::MockToken, ());
        let collateral_id = env.register(crate::test::MockToken, ());
        let vault_id = env.register(VaultContract, ());

        let push = crate::test::MockPriceFeedClient::new(&env, &push_id);
        let collateral = crate::test::MockTokenClient::new(&env, &collateral_id);
        let vault = VaultContractClient::new(&env, &vault_id);
        let admin = Address::generate(&env);
        let user = Address::generate(&env);

        vault.initialize(&admin, &smt_id, &push_id);
        vault.set_collateral_config(&collateral_id, &15000, &13000, &1000);
        vault.set_twap_oracle(&push_id, &500u32);

        push.set_price(&collateral_id, &1_0000000);
        collateral.mint(&user, &1_000_000_0000000i128);

        (env, vault, collateral_id, user)
    }

    proptest! {
        #![proptest_config(ProptestConfig::with_cases(32))]

        #[test]
        fn fuzz_deposit_and_mint_valid(
            smt_amount in 1i128..100_0000000i128,
        ) {
            let (_env, vault, collateral_id, user) = env_client_feeds();

            // With price = 1 and ratio 15000/10000 = 1.5,
            // choose collateral_amount in [min_collateral, min_collateral + 50M]
            let min_collateral = smt_amount * 15000 / BP_DIVISOR as i128;
            let collateral_amount = min_collateral + 1_0000000;

            let vault_id = vault.deposit_and_mint(&user, &collateral_id, &collateral_amount, &smt_amount);
            prop_assert!(vault_id > 0);
            let position = vault.get_vault(&vault_id);
            prop_assert_eq!(position.debt, smt_amount);
        }
    }

    /// Explicit boundary panic tests for invalid deposit/mint calls.
    #[test]
    #[should_panic(expected = "amounts must be positive")]
    fn rejects_zero_collateral_amount() {
        let (_env, vault, collateral_id, user) = env_client_feeds();
        vault.deposit_and_mint(&user, &collateral_id, &0, &100_0000000);
    }

    #[test]
    #[should_panic(expected = "amounts must be positive")]
    fn rejects_zero_smt_amount() {
        let (_env, vault, collateral_id, user) = env_client_feeds();
        vault.deposit_and_mint(&user, &collateral_id, &150_0000000, &0);
    }

    #[test]
    #[should_panic(expected = "insufficient collateral ratio")]
    fn rejects_insufficient_collateral_ratio() {
        let (_env, vault, collateral_id, user) = env_client_feeds();
        vault.deposit_and_mint(&user, &collateral_id, &100_0000000, &100_0000000);
    }
}
