use soroban_sdk::{
    contract, contractimpl, contracttype, symbol_short, Address, BytesN, Env, IntoVal, String, Vec, Symbol,
};

#[contracttype]
#[derive(Clone)]
enum DataKey {
    WasmHash,
    Admin,
    Tokens,
}

#[contract]
pub struct TokenFactory;

#[contractimpl]
impl TokenFactory {
    /// Initializes the factory with an admin and the WASM hash of the token contract to deploy.
    ///
    /// # Arguments
    /// * `admin`     - The address that can update the WASM hash.
    /// * `wasm_hash` - The SHA-256 hash of the token contract WASM to be deployed.
    ///
    /// # Panics
    /// Panics if the contract has already been initialized.
    pub fn initialize(e: Env, admin: Address, wasm_hash: BytesN<32>) {
        if e.storage().instance().has(&DataKey::Admin) {
            panic!("already initialized");
        }
        e.storage().instance().set(&DataKey::Admin, &admin);
        e.storage().instance().set(&DataKey::WasmHash, &wasm_hash);
        
        // Initialize an empty registry
        let initial_tokens: Vec<Address> = Vec::new(&e);
        e.storage().instance().set(&DataKey::Tokens, &initial_tokens);
    }

    /// Deploys a new token contract and initializes it in a single transaction.
    ///
    /// # Arguments
    /// * `salt`    - A unique 32-byte salt for the contract deployment.
    /// * `admin`   - The address that will be the administrator of the new token.
    /// * `decimal` - Number of decimal places for the new token.
    /// * `name`    - The name of the new token.
    /// * `symbol`  - The symbol of the new token.
    ///
    /// # Returns
    /// The address of the newly deployed token contract.
    ///
    /// # Events
    /// Emits a `contract_deployed` event with the new contract address and admin.
    pub fn create_token(
        e: Env,
        salt: BytesN<32>,
        admin: Address,
        decimal: u32,
        name: String,
        symbol: String,
    ) -> Address {
        let wasm_hash: BytesN<32> = e.storage().instance().get(&DataKey::WasmHash).expect("not initialized");
        
        // Deploy the contract using the provided salt and stored WASM hash
        // deployer().with_current_contract(salt).deploy(wasm_hash) creates a new contract
        // from the WASM hash using the factory's address as a parent.
        let address = e.deployer().with_current_contract(salt).deploy_v2(wasm_hash, ());
        
        // Initialize the newly deployed token contract using the provided parameters.
        // It's expected that the token contract has an 'initialize' method with the following signature:
        // fn initialize(e: Env, admin: Address, decimal: u32, name: String, symbol: String)
        let init_args = soroban_sdk::vec![
            &e,
            admin.clone().into_val(&e),
            decimal.into_val(&e),
            name.clone().into_val(&e),
            symbol.clone().into_val(&e),
        ];

        e.invoke_contract::<()>(
            &address,
            &Symbol::new(&e, "initialize"),
            init_args,
        );
        
        // Update the registry of deployed contract IDs
        let mut tokens: Vec<Address> = e.storage().instance().get(&DataKey::Tokens).unwrap_or(Vec::new(&e));
        tokens.push_back(address.clone());
        e.storage().instance().set(&DataKey::Tokens, &tokens);
        
        // Emit success event for off-chain listeners to track new token deployments
        let topics = (symbol_short!("factory"), symbol_short!("deploy"));
        e.events().publish(topics, (address.clone(), admin));
        
        address
    }

    /// Returns the list of all token contracts deployed by this factory.
    pub fn get_tokens(e: Env) -> Vec<Address> {
        e.storage().instance().get(&DataKey::Tokens).unwrap_or(Vec::new(&e))
    }

    /// Returns the current version of the contract.
    ///
    /// # Returns
    /// A `String` representing the version (e.g., "1.0.0").
    pub fn version(e: Env) -> String {
        String::from_str(&e, "1.0.0")
    }

    /// Returns the health status of the contract.
    ///
    /// # Returns
    /// A `String` representing the status (e.g., "alive").
    pub fn status(e: Env) -> String {
        String::from_str(&e, "alive")
    }

    /// Updates the WASM hash used for future deployments.
    /// Only the factory admin can call this.
    ///
    /// # Arguments
    /// * `new_wasm_hash` - The updated SHA-256 hash of the token contract WASM.
    ///
    /// # Authorization
    /// Requires the factory administrator to authorize.
    pub fn update_wasm_hash(e: Env, new_wasm_hash: BytesN<32>) {
        let admin: Address = e.storage().instance().get(&DataKey::Admin).expect("not initialized");
        admin.require_auth();
        e.storage().instance().set(&DataKey::WasmHash, &new_wasm_hash);
    }
}
