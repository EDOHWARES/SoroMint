use soroban_sdk::{contracttype, Address};

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
#[contracttype]
pub enum ConfigKey {
    Admin,
    SmtToken,
    Oracle,
    Assets,
    AssetConfig(Address),
}

#[contracttype]
pub enum DataKey {
    Config(ConfigKey),
    UserCollateral(Address, Address),
    UserDebt(Address),
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AssetConfig {
    pub ltv_bps: u32,             // Loan-to-Value (e.g. 7000 = 70%)
    pub liquidation_threshold: u32, // (e.g. 8000 = 80%)
    pub liquidation_bonus: u32,     // (e.g. 500 = 5% bonus to liquidator)
    pub is_active: bool,
}
