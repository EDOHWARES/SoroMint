use soroban_sdk::{contracttype, Address, Map, Symbol};

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Admin,
    SmtToken,
    Oracle,
    VaultCounter,
    Vault(u64),
    UserVaults(Address),
    CollateralConfig(Address),
    Reentrancy(Symbol),
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct VaultPosition {
    pub owner: Address,
    pub collaterals: Map<Address, i128>,
    pub debt: i128,
    pub created_at: u64,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CollateralConfig {
    pub enabled: bool,
    pub min_collateral_ratio: u32,
    pub liquidation_threshold: u32,
    pub liquidation_penalty: u32,
}
