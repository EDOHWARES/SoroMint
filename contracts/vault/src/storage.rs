use soroban_sdk::{contracttype, Address, Map};

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
    VaultInfo, // Issue #470: Bundling related fields into single storage segments
    Balance(Address),
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct VaultInfo {
    pub admin: Address,
    pub token: Address,
    pub total_liabilities: i128,
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
