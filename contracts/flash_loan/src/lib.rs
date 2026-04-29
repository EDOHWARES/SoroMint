#![no_std]
use soroban_sdk::{
    contract, contractimpl, contracttype, vec, Address, Bytes, Env, Symbol, IntoVal
};
use soroban_sdk::token::Client as TokenClient;

#[contracttype]
pub enum DataKey {
    Token,
    FeeBps, 
}

#[contract]
pub struct SmtFlashLoanProvider;

#[contractimpl]
impl SmtFlashLoanProvider {
    pub fn initialize(env: Env, token: Address, fee_bps: u32) {
        env.storage().instance().set(&DataKey::Token, &token);
        env.storage().instance().set(&DataKey::FeeBps, &fee_bps);
    }

    pub fn flash_loan(
        env: Env,
        borrower_contract: Address,
        amount: i128,
        params: Bytes,
    ) {
        let token_id: Address = env.storage().instance().get(&DataKey::Token).unwrap();
        let fee_bps: u32 = env.storage().instance().get(&DataKey::FeeBps).unwrap();
        let token = TokenClient::new(&env, &token_id);

        let fee = (amount * (fee_bps as i128)) / 10000;
        let balance_before = token.balance(&env.current_contract_address());

        // Optimistic transfer
        token.transfer(&env.current_contract_address(), &borrower_contract, &amount);

        // Cross-Contract Call to the borrower.
        // We explicitly pass the provider's address so the borrower knows where to return funds.
        env.invoke_contract::<()>(
            &borrower_contract,
            &Symbol::new(&env, "receive_loan"),
            vec![
                &env,
                env.current_contract_address().into_val(&env),
                amount.into_val(&env),
                fee.into_val(&env),
                params.into_val(&env),
            ],
        );

        // Strict verification
        let balance_after = token.balance(&env.current_contract_address());
        let required_balance = balance_before + fee;

        assert!(
            balance_after >= required_balance,
            "SMT FlashLoan: Repayment plus interest not met"
        );
    }
}

#[cfg(test)]
mod test {
    use super::*;
    use soroban_sdk::{testutils::Address as _, Address, Env, token};

    // A borrower that intentionally steals the funds to test our security
    #[contract]
    pub struct MaliciousBorrower;
    
    #[contractimpl]
    impl MaliciousBorrower {
        pub fn receive_loan(_env: Env, _provider: Address, _amount: i128, _fee: i128, _params: Bytes) {
            // Do absolutely nothing. Keep the money!
        }
    }

    #[test]
    #[should_panic(expected = "SMT FlashLoan: Repayment plus interest not met")]
    fn test_flash_loan_fails_if_not_repaid() {
        let env = Env::default();
        env.mock_all_auths();

        // 1. Setup mock token
        let admin = Address::generate(&env);
        let token_contract = env.register_stellar_asset_contract_v2(admin);
        let token_admin = token::StellarAssetClient::new(&env, &token_contract.address());
        
        // 2. Setup Provider
        let provider_id = env.register(SmtFlashLoanProvider, ());
        let provider = SmtFlashLoanProviderClient::new(&env, &provider_id);
        provider.initialize(&token_contract.address(), &50);

        // 3. Fund Provider
        token_admin.mint(&provider_id, &10_000);

        // 4. Setup Malicious Borrower (Properly registered to the network this time!)
        let malicious_borrower_id = env.register(MaliciousBorrower, ());

        // 5. Request the loan!
        // The malicious borrower does nothing, so the provider's final assert! statement will trip.
        provider.flash_loan(&malicious_borrower_id, &1000, &Bytes::new(&env));
    }
}