#![cfg(test)]

use super::*;
use soroban_sdk::{
    testutils::Address as _,
    token::{Client as TokenClient, StellarAssetClient},
    Address, BytesN, Env,
};

fn setup_token(e: &Env, admin: &Address) -> Address {
    let token_id = e.register_stellar_asset_contract_v2(admin.clone());
    StellarAssetClient::new(e, &token_id.address()).set_admin(admin);
    token_id.address()
}

#[test]
fn test_lottery_flow() {
    let e = Env::default();
    e.mock_all_auths();

    let admin = Address::generate(&e);
    let player1 = Address::generate(&e);
    let player2 = Address::generate(&e);

    let token_addr = setup_token(&e, &admin);
    let token = TokenClient::new(&e, &token_addr);
    StellarAssetClient::new(&e, &token_addr).mint(&player1, &1000);
    StellarAssetClient::new(&e, &token_addr).mint(&player2, &1000);

    let contract_id = e.register(Lottery, ());
    let client = LotteryClient::new(&e, &contract_id);

    client.initialize(&admin, &token_addr, &100i128);

    // secret = [1u8; 32], commit = sha256([1u8; 32])
    let secret = BytesN::from_array(&e, &[1u8; 32]);
    let commit = e.crypto().sha256(&secret.clone().into()).to_bytes();
    client.commit_vrf(&commit);

    client.enter(&player1);
    client.enter(&player2);

    assert_eq!(client.get_participants().len(), 2);

    client.reveal_vrf(&secret);

    // Winner should be one of the two players
    let winner = client.get_winner();
    assert!(winner == player1 || winner == player2);
    // Winner receives 200 (2 tickets * 100)
    assert_eq!(token.balance(&winner), 1000 - 100 + 200); // minted 1000, paid 100, received 200
}
