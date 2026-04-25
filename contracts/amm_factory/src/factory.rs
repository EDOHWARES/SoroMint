use soroban_sdk::{
    contract, contractimpl, contracttype, symbol_short, Address, BytesN, Env, IntoVal, String,
    Symbol, Vec,
};
#[cfg(test)]
use soromint_amm_pool::AmmPool;

const MAX_FEE_BPS: u32 = 1_000;

#[contracttype]
pub enum ConfigKey {
    Admin,
    PoolWasmHash,
    TokenFactory,
    XlmToken,
    UsdcToken,
    FeeBps,
}

#[contracttype]
pub enum DataKey {
    Config(ConfigKey),
    Pools,
    PairPool(Address, Address),
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AmmFactoryConfig {
    pub admin: Address,
    pub pool_wasm_hash: BytesN<32>,
    pub token_factory: Address,
    pub xlm_token: Address,
    pub usdc_token: Address,
    pub fee_bps: u32,
}

#[contract]
pub struct AmmFactory;

#[contractimpl]
impl AmmFactory {
    pub fn initialize(
        e: Env,
        admin: Address,
        pool_wasm_hash: BytesN<32>,
        token_factory: Address,
        xlm_token: Address,
        usdc_token: Address,
        fee_bps: u32,
    ) {
        if e.storage().instance().has(&DataKey::Config(ConfigKey::Admin)) {
            panic!("already initialized");
        }
        if xlm_token == usdc_token {
            panic!("quote assets must differ");
        }
        if fee_bps > MAX_FEE_BPS {
            panic!("fee too high");
        }

        e.storage().instance().set(&DataKey::Config(ConfigKey::Admin), &admin);
        e.storage()
            .instance()
            .set(&DataKey::Config(ConfigKey::PoolWasmHash), &pool_wasm_hash);
        e.storage()
            .instance()
            .set(&DataKey::Config(ConfigKey::TokenFactory), &token_factory);
        e.storage().instance().set(&DataKey::Config(ConfigKey::XlmToken), &xlm_token);
        e.storage().instance().set(&DataKey::Config(ConfigKey::UsdcToken), &usdc_token);
        e.storage().instance().set(&DataKey::Config(ConfigKey::FeeBps), &fee_bps);
        e.storage()
            .instance()
            .set(&DataKey::Pools, &Vec::<Address>::new(&e));
    }

    pub fn config(e: Env) -> AmmFactoryConfig {
        AmmFactoryConfig {
            admin: Self::read_admin(&e),
            pool_wasm_hash: Self::read_pool_wasm_hash(&e),
            token_factory: Self::read_token_factory(&e),
            xlm_token: Self::read_xlm_token(&e),
            usdc_token: Self::read_usdc_token(&e),
            fee_bps: Self::read_fee_bps(&e),
        }
    }

    pub fn create_pool(
        e: Env,
        salt: BytesN<32>,
        minted_token: Address,
        quote_token: Address,
    ) -> Address {
        let pool_wasm_hash = Self::read_pool_wasm_hash(&e);
        let token_factory = Self::read_token_factory(&e);
        let fee_bps = Self::read_fee_bps(&e);

        if !Self::is_supported_quote_token(e.clone(), quote_token.clone()) {
            panic!("unsupported quote token");
        }
        if minted_token == quote_token {
            panic!("pool assets must differ");
        }
        if !Self::is_registered_minted_token(&e, &token_factory, &minted_token) {
            panic!("token is not a SoroMint deployment");
        }
        if e.storage().instance().has(&DataKey::PairPool(
            minted_token.clone(),
            quote_token.clone(),
        )) {
            panic!("pool already exists");
        }

        let address = Self::deploy_pool(&e, salt, pool_wasm_hash);

        let init_args = soroban_sdk::vec![
            &e,
            e.current_contract_address().into_val(&e),
            minted_token.clone().into_val(&e),
            quote_token.clone().into_val(&e),
            fee_bps.into_val(&e),
        ];
        e.invoke_contract::<()>(&address, &Symbol::new(&e, "initialize"), init_args);

        e.storage().instance().set(
            &DataKey::PairPool(minted_token.clone(), quote_token.clone()),
            &address,
        );

        let mut pools: Vec<Address> = e
            .storage()
            .instance()
            .get(&DataKey::Pools)
            .unwrap_or(Vec::new(&e));
        pools.push_back(address.clone());
        e.storage().instance().set(&DataKey::Pools, &pools);

        e.events().publish(
            (symbol_short!("amm_fact"), symbol_short!("deploy")),
            (minted_token, quote_token, address.clone()),
        );

        address
    }

    pub fn get_pool(e: Env, minted_token: Address, quote_token: Address) -> Option<Address> {
        e.storage()
            .instance()
            .get(&DataKey::PairPool(minted_token, quote_token))
    }

    pub fn get_pools(e: Env) -> Vec<Address> {
        e.storage()
            .instance()
            .get(&DataKey::Pools)
            .unwrap_or(Vec::new(&e))
    }

    pub fn is_supported_quote_token(e: Env, quote_token: Address) -> bool {
        let xlm_token = Self::read_xlm_token(&e);
        let usdc_token = Self::read_usdc_token(&e);
        quote_token == xlm_token || quote_token == usdc_token
    }

    pub fn is_minted_token(e: Env, token: Address) -> bool {
        let token_factory = Self::read_token_factory(&e);
        Self::is_registered_minted_token(&e, &token_factory, &token)
    }

    pub fn update_pool_wasm_hash(e: Env, new_pool_wasm_hash: BytesN<32>) {
        let admin = Self::read_admin(&e);
        admin.require_auth();
        e.storage()
            .instance()
            .set(&DataKey::Config(ConfigKey::PoolWasmHash), &new_pool_wasm_hash);
    }

    pub fn update_fee_bps(e: Env, new_fee_bps: u32) {
        let admin = Self::read_admin(&e);
        admin.require_auth();
        if new_fee_bps > MAX_FEE_BPS {
            panic!("fee too high");
        }
        e.storage().instance().set(&DataKey::Config(ConfigKey::FeeBps), &new_fee_bps);
    }

    pub fn version(e: Env) -> String {
        String::from_str(&e, "1.0.0")
    }

    pub fn status(e: Env) -> String {
        String::from_str(&e, "alive")
    }
}

impl AmmFactory {
    fn read_admin(e: &Env) -> Address {
        e.storage()
            .instance()
            .get(&DataKey::Config(ConfigKey::Admin))
            .expect("not initialized")
    }

    fn read_pool_wasm_hash(e: &Env) -> BytesN<32> {
        e.storage()
            .instance()
            .get(&DataKey::Config(ConfigKey::PoolWasmHash))
            .expect("not initialized")
    }

    fn read_token_factory(e: &Env) -> Address {
        e.storage()
            .instance()
            .get(&DataKey::Config(ConfigKey::TokenFactory))
            .expect("not initialized")
    }

    fn read_xlm_token(e: &Env) -> Address {
        e.storage()
            .instance()
            .get(&DataKey::Config(ConfigKey::XlmToken))
            .expect("not initialized")
    }

    fn read_usdc_token(e: &Env) -> Address {
        e.storage()
            .instance()
            .get(&DataKey::Config(ConfigKey::UsdcToken))
            .expect("not initialized")
    }

    fn read_fee_bps(e: &Env) -> u32 {
        e.storage().instance().get(&DataKey::Config(ConfigKey::FeeBps)).unwrap_or(0)
    }

    fn is_registered_minted_token(e: &Env, token_factory: &Address, token: &Address) -> bool {
        let tokens: Vec<Address> = e.invoke_contract(
            token_factory,
            &Symbol::new(e, "get_tokens"),
            soroban_sdk::vec![e],
        );
        tokens.contains(token.clone())
    }

    #[cfg(not(test))]
    fn deploy_pool(e: &Env, salt: BytesN<32>, pool_wasm_hash: BytesN<32>) -> Address {
        e.deployer()
            .with_current_contract(salt)
            .deploy_v2(pool_wasm_hash, ())
    }

    #[cfg(test)]
    fn deploy_pool(e: &Env, salt: BytesN<32>, _pool_wasm_hash: BytesN<32>) -> Address {
        let address = e.deployer().with_current_contract(salt).deployed_address();
        e.register_at(&address, AmmPool, ());
        address
    }
}
