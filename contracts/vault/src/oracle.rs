use soroban_sdk::{Address, Env, IntoVal, Symbol};

/// Get price from oracle contract
/// Returns price with 7 decimals (e.g., 1.5 USD = 1_5000000)
pub fn get_price(e: &Env, oracle: &Address, token: &Address) -> i128 {
    let args = soroban_sdk::vec![e, token.into_val(e)];
    e.invoke_contract::<i128>(oracle, &Symbol::new(e, "get_price"), args)
}
