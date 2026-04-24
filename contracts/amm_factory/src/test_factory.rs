#![cfg(test)]

use crate::{AmmFactory, AmmFactoryClient};
use soroban_sdk::{testutils::Address as _, Address, BytesN, Env, String};
use soromint_amm_pool::AmmPoolClient;
use soromint_factory::{TokenFactory, TokenFactoryClient};
use soromint_token::{SoroMintToken, SoroMintTokenClient};

mod token_wasm {
    soroban_sdk::contractimport!(
        file = "../../target/wasm32-unknown-unknown/release/soromint_token.wasm"
    );
}

fn deploy_quote_token(
    e: &Env,
    name: &str,
    symbol: &str,
) -> (Address, SoroMintTokenClient<'static>) {
    let admin = Address::generate(e);
    let token_id = e.register(SoroMintToken, ());
    let token = SoroMintTokenClient::new(e, &token_id);
    token.initialize(
        &admin,
        &7u32,
        &String::from_str(e, name),
        &String::from_str(e, symbol),
    );
    (token_id, token)
}

fn setup() -> (
    Env,
    AmmFactoryClient<'static>,
    TokenFactoryClient<'static>,
    Address,
    Address,
) {
    let e = Env::default();
    e.mock_all_auths();

    let admin = Address::generate(&e);

    let token_factory_id = e.register(TokenFactory, ());
    let token_factory = TokenFactoryClient::new(&e, &token_factory_id);
    let token_wasm_hash = e.deployer().upload_contract_wasm(token_wasm::WASM);
    token_factory.initialize(&admin, &token_wasm_hash);

    let (xlm_token, _) = deploy_quote_token(&e, "Wrapped XLM", "WXLM");
    let (usdc_token, _) = deploy_quote_token(&e, "Wrapped USDC", "USDC");

    let amm_factory_id = e.register(AmmFactory, ());
    let amm_factory = AmmFactoryClient::new(&e, &amm_factory_id);
    amm_factory.initialize(
        &admin,
        &BytesN::from_array(&e, &[3; 32]),
        &token_factory_id,
        &xlm_token,
        &usdc_token,
        &30u32,
    );

    (e, amm_factory, token_factory, xlm_token, usdc_token)
}

fn deploy_minted_token(e: &Env, token_factory: &TokenFactoryClient<'_>, salt_byte: u8) -> Address {
    let salt = BytesN::from_array(e, &[salt_byte; 32]);
    let token_admin = Address::generate(e);
    token_factory.create_token(
        &salt,
        &token_admin,
        &7u32,
        &String::from_str(e, "Minted Token"),
        &String::from_str(e, "MINT"),
    )
}

#[test]
fn test_factory_deploys_pool_for_minted_token_and_xlm() {
    let (e, amm_factory, token_factory, xlm_token, _usdc_token) = setup();
    let minted_token = deploy_minted_token(&e, &token_factory, 7);

    let pool_address =
        amm_factory.create_pool(&BytesN::from_array(&e, &[9; 32]), &minted_token, &xlm_token);

    assert_eq!(amm_factory.get_pools().len(), 1);
    assert_eq!(
        amm_factory.get_pool(&minted_token, &xlm_token),
        Some(pool_address.clone())
    );

    let pool = AmmPoolClient::new(&e, &pool_address);
    let config = pool.config();
    assert_eq!(config.token, minted_token);
    assert_eq!(config.quote_token, xlm_token);
    assert_eq!(config.fee_bps, 30);
}

#[test]
fn test_factory_supports_both_xlm_and_usdc_pairs() {
    let (e, amm_factory, token_factory, xlm_token, usdc_token) = setup();
    let minted_a = deploy_minted_token(&e, &token_factory, 1);
    let minted_b = deploy_minted_token(&e, &token_factory, 2);

    let xlm_pool =
        amm_factory.create_pool(&BytesN::from_array(&e, &[3; 32]), &minted_a, &xlm_token);
    let usdc_pool =
        amm_factory.create_pool(&BytesN::from_array(&e, &[4; 32]), &minted_b, &usdc_token);

    assert_eq!(amm_factory.get_pool(&minted_a, &xlm_token), Some(xlm_pool));
    assert_eq!(
        amm_factory.get_pool(&minted_b, &usdc_token),
        Some(usdc_pool)
    );
    assert_eq!(amm_factory.get_pools().len(), 2);
}

#[test]
#[should_panic(expected = "unsupported quote token")]
fn test_factory_rejects_unsupported_quote_assets() {
    let (e, amm_factory, token_factory, _xlm_token, _usdc_token) = setup();
    let minted_token = deploy_minted_token(&e, &token_factory, 5);
    let (other_quote, _) = deploy_quote_token(&e, "Other", "OTR");

    amm_factory.create_pool(
        &BytesN::from_array(&e, &[6; 32]),
        &minted_token,
        &other_quote,
    );
}

#[test]
#[should_panic(expected = "token is not a SoroMint deployment")]
fn test_factory_rejects_tokens_outside_soromint_registry() {
    let (e, amm_factory, _token_factory, xlm_token, _usdc_token) = setup();
    let (external_token, _) = deploy_quote_token(&e, "External", "EXT");

    amm_factory.create_pool(
        &BytesN::from_array(&e, &[8; 32]),
        &external_token,
        &xlm_token,
    );
}

#[test]
#[should_panic(expected = "pool already exists")]
fn test_factory_rejects_duplicate_pair_creation() {
    let (e, amm_factory, token_factory, xlm_token, _usdc_token) = setup();
    let minted_token = deploy_minted_token(&e, &token_factory, 10);

    amm_factory.create_pool(
        &BytesN::from_array(&e, &[11; 32]),
        &minted_token,
        &xlm_token,
    );
    amm_factory.create_pool(
        &BytesN::from_array(&e, &[12; 32]),
        &minted_token,
        &xlm_token,
    );
}
