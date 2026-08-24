use soroban_sdk::{contracttype, Address, Map, Symbol};

#[contracttype]
pub enum ConfigKey {
    Admin,
    SmtToken,
    Oracle,
    Counter,
    TwapOracle,
    DivergenceBps,
    LiqPaused,
}

#[contracttype]
pub enum DataKey {
    Config(ConfigKey),
    Vault(u64),
    UserVaults(Address),
    Collateral(Address),
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

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct TwapConfig {
    pub twap_oracle: Address,
    pub divergence_threshold_bps: u32,
    pub liquidations_paused: bool,
    pub configured: bool,
}
