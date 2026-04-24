use soroban_sdk::{contracttype, Address};

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum DataKey {
    Admin,
    SmtToken,
    AssetConfig(Address),
    UserCollateral(Address, Address), // User, Asset
    UserDebt(Address),
    Oracle,
    Assets, // Global list of supported assets
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AssetConfig {
    pub ltv_bps: u32,             // Loan-to-Value (e.g. 7000 = 70%)
    pub liquidation_threshold: u32, // (e.g. 8000 = 80%)
    pub liquidation_bonus: u32,     // (e.g. 500 = 5% bonus to liquidator)
    pub is_active: bool,
}
