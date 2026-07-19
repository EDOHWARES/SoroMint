use crate::multisig::{
    build_deploy_payload_hash, require_threshold, verify_multisig_signatures, MultisigDeployPayload,
    OwnerSignature,
};
use soroban_sdk::{
    contract, contractimpl, contracttype, symbol_short, Address, Bytes, BytesN, Env, IntoVal,
    String, Symbol, Vec,
};

#[contracttype]
pub enum ConfigKey {
    Admin,
    WasmHash,
    Tokens,
    MultisigOwners,
}

#[contracttype]
pub enum DataKey {
    Config(ConfigKey),
    /// Marks a multisig deploy payload hash as consumed (replay protection).
    UsedPayload(BytesN<32>),
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
        if e.storage().instance().has(&DataKey::Config(ConfigKey::Admin)) {
            panic!("already initialized");
        }
        e.storage().instance().set(&DataKey::Config(ConfigKey::Admin), &admin);
        e.storage().instance().set(&DataKey::Config(ConfigKey::WasmHash), &wasm_hash);

        // Initialize an empty registry
        let initial_tokens: Vec<Address> = Vec::new(&e);
        e.storage()
            .instance()
            .set(&DataKey::Config(ConfigKey::Tokens), &initial_tokens);
    }

    /// Deploys a new token contract with multi-sig admin support.
    ///
    /// # Arguments
    /// * `salt`           - A unique 32-byte salt for the contract deployment.
    /// * `admin`          - The address that will be the administrator (can be multi-sig contract).
    /// * `decimal`        - Number of decimal places for the new token.
    /// * `name`           - The name of the new token.
    /// * `symbol`         - The symbol of the new token.
    /// * `is_multisig`    - Whether the admin is a multi-sig contract.
    ///
    /// # Returns
    /// The address of the newly deployed token contract.
    ///
    /// # Events
    /// Emits a `contract_deployed` event with the new contract address and admin.
    pub fn create_token_with_multisig(
        e: Env,
        salt: BytesN<32>,
        admin: Address,
        decimal: u32,
        name: String,
        symbol: String,
        is_multisig: bool,
    ) -> Address {
        let wasm_hash: BytesN<32> = e
            .storage()
            .instance()
            .get(&DataKey::Config(ConfigKey::WasmHash))
            .expect("not initialized");

        let address = e
            .deployer()
            .with_current_contract(salt)
            .deploy_v2(wasm_hash, ());

        let init_args = soroban_sdk::vec![
            &e,
            admin.clone().into_val(&e),
            decimal.into_val(&e),
            name.clone().into_val(&e),
            symbol.clone().into_val(&e),
        ];

        e.invoke_contract::<()>(&address, &Symbol::new(&e, "initialize"), init_args);

        let mut tokens: Vec<Address> = e
            .storage()
            .instance()
            .get(&DataKey::Config(ConfigKey::Tokens))
            .unwrap_or(Vec::new(&e));
        tokens.push_back(address.clone());
        e.storage().instance().set(&DataKey::Config(ConfigKey::Tokens), &tokens);

        let topics = if is_multisig {
            (symbol_short!("factory"), symbol_short!("multisig"))
        } else {
            (symbol_short!("factory"), symbol_short!("deploy"))
        };
        e.events().publish(topics, (address.clone(), admin));

        address
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
        let wasm_hash: BytesN<32> = e
            .storage()
            .instance()
            .get(&DataKey::Config(ConfigKey::WasmHash))
            .expect("not initialized");

        // Deploy the contract using the provided salt and stored WASM hash
        // deployer().with_current_contract(salt).deploy(wasm_hash) creates a new contract
        // from the WASM hash using the factory's address as a parent.
        let address = e
            .deployer()
            .with_current_contract(salt)
            .deploy_v2(wasm_hash, ());

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

        e.invoke_contract::<()>(&address, &Symbol::new(&e, "initialize"), init_args);

        // Update the registry of deployed contract IDs
        let mut tokens: Vec<Address> = e
            .storage()
            .instance()
            .get(&DataKey::Config(ConfigKey::Tokens))
            .unwrap_or(Vec::new(&e));
        tokens.push_back(address.clone());
        e.storage().instance().set(&DataKey::Config(ConfigKey::Tokens), &tokens);

        // Emit success event for off-chain listeners to track new token deployments
        let topics = (symbol_short!("factory"), symbol_short!("deploy"));
        e.events().publish(topics, (address.clone(), admin));

        address
    }

    /// Deploys a new token contract (v2), initializes it, and sets a metadata hash.
    ///
    /// # Arguments
    /// * `salt`          - A unique 32-byte salt for the contract deployment.
    /// * `admin`         - The address that will be the administrator of the new token.
    /// * `decimal`       - Number of decimal places for the new token.
    /// * `name`          - The name of the new token.
    /// * `symbol`        - The symbol of the new token.
    /// * `metadata_hash` - An IPFS or content-addressed hash for off-chain metadata.
    ///
    /// # Returns
    /// The address of the newly deployed token contract.
    ///
    /// # Events
    /// Emits a `contract_deployed` event with the new contract address and admin.
    pub fn v2_create_token(
        e: Env,
        salt: BytesN<32>,
        admin: Address,
        decimal: u32,
        name: String,
        symbol: String,
        metadata_hash: String,
    ) -> Address {
        let wasm_hash: BytesN<32> = e
            .storage()
            .instance()
            .get(&DataKey::Config(ConfigKey::WasmHash))
            .expect("not initialized");

        let address = e
            .deployer()
            .with_current_contract(salt)
            .deploy_v2(wasm_hash, ());

        let init_args = soroban_sdk::vec![
            &e,
            admin.clone().into_val(&e),
            decimal.into_val(&e),
            name.clone().into_val(&e),
            symbol.clone().into_val(&e),
        ];

        e.invoke_contract::<()>(&address, &Symbol::new(&e, "initialize"), init_args);

        // Set the metadata hash on the newly deployed token contract
        let meta_args = soroban_sdk::vec![&e, metadata_hash.into_val(&e),];

        e.invoke_contract::<()>(&address, &Symbol::new(&e, "set_metadata_hash"), meta_args);

        // Update the registry of deployed contract IDs
        let mut tokens: Vec<Address> = e
            .storage()
            .instance()
            .get(&DataKey::Config(ConfigKey::Tokens))
            .unwrap_or(Vec::new(&e));
        tokens.push_back(address.clone());
        e.storage().instance().set(&DataKey::Config(ConfigKey::Tokens), &tokens);

        // Emit success event for off-chain listeners to track new token deployments
        let topics = (symbol_short!("factory"), symbol_short!("deploy"));
        e.events().publish(topics, (address.clone(), admin));

        address
    }

    /// Returns the list of all token contracts deployed by this factory.
    pub fn get_tokens(e: Env) -> Vec<Address> {
        e.storage()
            .instance()
            .get(&DataKey::Config(ConfigKey::Tokens))
            .unwrap_or(Vec::new(&e))
    }

    /// Returns the current version of the contract.
    ///
    /// # Returns
    /// A `String` representing the version (e.g., "1.0.0").
    pub fn version(e: Env) -> String {
        String::from_str(&e, "2.0.0")
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
        let admin: Address = e
            .storage()
            .instance()
            .get(&DataKey::Config(ConfigKey::Admin))
            .expect("not initialized");
        admin.require_auth();
        e.storage()
            .instance()
            .set(&DataKey::Config(ConfigKey::WasmHash), &new_wasm_hash);
    }

    /// Registers the ed25519 public keys authorized to approve multisig deployments.
    ///
    /// # Authorization
    /// Requires the factory administrator to authorize.
    pub fn set_multisig_owners(e: Env, owners: Vec<BytesN<32>>) {
        let admin: Address = e
            .storage()
            .instance()
            .get(&DataKey::Config(ConfigKey::Admin))
            .expect("not initialized");
        admin.require_auth();

        if owners.is_empty() {
            panic!("owners required");
        }

        e.storage()
            .instance()
            .set(&DataKey::Config(ConfigKey::MultisigOwners), &owners);
    }

    /// Returns the registered multisig owner public keys.
    pub fn get_multisig_owners(e: Env) -> Vec<BytesN<32>> {
        e.storage()
            .instance()
            .get(&DataKey::Config(ConfigKey::MultisigOwners))
            .unwrap_or(Vec::new(&e))
    }

    /// Deploys a token contract after verifying a multisig threshold of owner signatures.
    ///
    /// # Arguments
    /// * `salt`       - Unique 32-byte salt for deployment.
    /// * `admin`      - Administrator of the new token.
    /// * `decimal`    - Token decimals.
    /// * `name`       - Token name.
    /// * `symbol`     - Token symbol.
    /// * `signatures` - Ed25519 signatures over the deploy payload hash.
    /// * `threshold`  - Minimum number of unique valid signatures required.
    /// * `nonce`      - Unique nonce included in the signed payload (anti-replay).
    ///
    /// # Panics
    /// * Below-threshold valid signatures
    /// * Duplicate signatures from the same owner key
    /// * Replayed payload (same signed parameters + nonce)
    /// * Unknown / invalid cryptographic signatures
    ///
    /// # Events
    /// Emits `(factory, msigdep)` with `(token, admin, signer_keys, nonce)`.
    pub fn deploy_multisig(
        e: Env,
        salt: BytesN<32>,
        admin: Address,
        decimal: u32,
        name: String,
        symbol: String,
        signatures: Vec<OwnerSignature>,
        threshold: u32,
        nonce: u64,
    ) -> Address {
        let owners: Vec<BytesN<32>> = e
            .storage()
            .instance()
            .get(&DataKey::Config(ConfigKey::MultisigOwners))
            .expect("multisig owners not configured");

        if threshold == 0 || threshold > owners.len() {
            panic!("invalid threshold");
        }

        let payload = MultisigDeployPayload {
            salt: salt.clone(),
            admin: admin.clone(),
            decimal,
            name: name.clone(),
            symbol: symbol.clone(),
            nonce,
        };
        let payload_hash = build_deploy_payload_hash(&e, &payload);

        if e.storage()
            .persistent()
            .has(&DataKey::UsedPayload(payload_hash.clone()))
        {
            panic!("payload already used");
        }

        let message: Bytes = payload_hash.clone().into();
        let valid_signers =
            verify_multisig_signatures(&e, &owners, &message, &signatures);
        require_threshold(valid_signers.len(), threshold);

        // Consume the payload before deployment to prevent replay if deploy re-enters.
        e.storage()
            .persistent()
            .set(&DataKey::UsedPayload(payload_hash), &true);

        let wasm_hash: BytesN<32> = e
            .storage()
            .instance()
            .get(&DataKey::Config(ConfigKey::WasmHash))
            .expect("not initialized");

        let address = e
            .deployer()
            .with_current_contract(salt)
            .deploy_v2(wasm_hash, ());

        let init_args = soroban_sdk::vec![
            &e,
            admin.clone().into_val(&e),
            decimal.into_val(&e),
            name.into_val(&e),
            symbol.into_val(&e),
        ];
        e.invoke_contract::<()>(&address, &Symbol::new(&e, "initialize"), init_args);

        let mut tokens: Vec<Address> = e
            .storage()
            .instance()
            .get(&DataKey::Config(ConfigKey::Tokens))
            .unwrap_or(Vec::new(&e));
        tokens.push_back(address.clone());
        e.storage()
            .instance()
            .set(&DataKey::Config(ConfigKey::Tokens), &tokens);

        let topics = (symbol_short!("factory"), symbol_short!("msigdep"));
        e.events()
            .publish(topics, (address.clone(), admin, valid_signers, nonce));

        address
    }
}
