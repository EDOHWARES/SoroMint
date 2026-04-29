use soroban_sdk::{Address, Env, IntoVal, Symbol};

/// Get price from oracle contract
/// Returns price with 7 decimals (e.g., 1.5 USD = 1_5000000)
pub fn get_price(e: &Env, oracle: &Address, token: &Address) -> i128 {
    let args = soroban_sdk::vec![e, token.into_val(e)];
    e.invoke_contract::<i128>(oracle, &Symbol::new(e, "get_price"), args)
}

/// Get multiple prices in batch
pub fn get_prices(e: &Env, oracle: &Address, tokens: &soroban_sdk::Vec<Address>) -> soroban_sdk::Vec<i128> {
    let args = soroban_sdk::vec![e, tokens.into_val(e)];
    e.invoke_contract::<soroban_sdk::Vec<i128>>(oracle, &Symbol::new(e, "get_prices"), args)
}

/// Check if oracle has price for token
pub fn has_price(e: &Env, oracle: &Address, token: &Address) -> bool {
    let args = soroban_sdk::vec![e, token.into_val(e)];
    e.invoke_contract::<bool>(oracle, &Symbol::new(e, "has_price"), args)
}
