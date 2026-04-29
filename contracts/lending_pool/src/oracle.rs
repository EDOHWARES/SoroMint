use soroban_sdk::{contractclient, Address, Env};

#[contractclient(name = "OracleClient")]
pub trait OracleInterface {
    /// Returns the price of the asset in SMT (base 7 decimals).
    fn get_price(e: Env, asset: Address) -> i128;
}
