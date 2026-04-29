use soroban_sdk::{symbol_short, Address, Env};

/// Emitted once when the contract is initialized.
///
/// Topics : ("div_init",)
/// Data   : (admin: Address, token_contract: Address)
pub fn emit_initialized(e: &Env, admin: &Address, token_contract: &Address) {
    e.events()
        .publish((symbol_short!("div_init"),), (admin, token_contract));
}

/// Emitted every time the issuer deposits XLM into the pool.
///
/// Topics : ("div_dep",)
/// Data   : (depositor: Address, amount: i128, new_dps: i128, total_distributed: i128)
pub fn emit_deposited(
    e: &Env,
    depositor: &Address,
    amount: i128,
    new_dps: i128,
    total_distributed: i128,
) {
    e.events().publish(
        (symbol_short!("div_dep"),),
        (depositor, amount, new_dps, total_distributed),
    );
}

/// Emitted every time a holder successfully claims their dividends.
///
/// Topics : ("div_claim",)
/// Data   : (holder: Address, amount: i128)
pub fn emit_claimed(e: &Env, holder: &Address, amount: i128) {
    e.events()
        .publish((symbol_short!("div_clm"),), (holder, amount));
}
