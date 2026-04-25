//! # Merkle Proof Whitelist Contract
//!
//! A gas-efficient whitelisting mechanism using Merkle proofs that allows
//! thousands of addresses to be whitelisted for a fraction of the cost.
//!
//! Instead of storing each whitelisted address on-chain, only the Merkle root
//! is stored. Users prove their whitelist status by providing a Merkle proof.

#![no_std]

mod events;
mod merkle;

#[cfg(test)]
mod test;

use soroban_sdk::{contract, contractimpl, contracttype, Address, BytesN, Env, Vec};

#[contracttype]
#[derive(Clone)]
pub enum ConfigKey {
    Admin,
    MerkleRoot,
    RootVersion,
}

#[contracttype]
pub enum DataKey {
    Config(ConfigKey),
    Nonce(Address),
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct WhitelistConfig {
    pub merkle_root: BytesN<32>,
    pub version: u32,
    pub updated_at: u64,
}

#[contract]
pub struct MerkleWhitelist;

#[contractimpl]
impl MerkleWhitelist {
    /// Initialize the contract with admin and initial Merkle root
    pub fn initialize(e: Env, admin: Address, merkle_root: BytesN<32>) {
        if e.storage().instance().has(&DataKey::Config(ConfigKey::Admin)) {
            panic!("already initialized");
        }

        e.storage().instance().set(&DataKey::Config(ConfigKey::Admin), &admin);
        e.storage().instance().set(&DataKey::Config(ConfigKey::MerkleRoot), &merkle_root);
        e.storage().instance().set(&DataKey::Config(ConfigKey::RootVersion), &1u32);

        events::emit_initialized(&e, &admin, &merkle_root);
    }

    /// Update the Merkle root (admin only)
    pub fn update_merkle_root(e: Env, new_root: BytesN<32>) {
        let admin: Address = e.storage().instance().get(&DataKey::Config(ConfigKey::Admin)).unwrap();
        admin.require_auth();

        let version: u32 = e
            .storage()
            .instance()
            .get(&DataKey::Config(ConfigKey::RootVersion))
            .unwrap_or(0);
        let new_version = version + 1;

        e.storage().instance().set(&DataKey::Config(ConfigKey::MerkleRoot), &new_root);
        e.storage()
            .instance()
            .set(&DataKey::Config(ConfigKey::RootVersion), &new_version);

        events::emit_root_updated(&e, &new_root, new_version);
    }

    /// Verify if an address is whitelisted using a Merkle proof
    pub fn verify_whitelist(e: Env, address: Address, proof: Vec<BytesN<32>>) -> bool {
        let merkle_root: BytesN<32> = e
            .storage()
            .instance()
            .get(&DataKey::Config(ConfigKey::MerkleRoot))
            .expect("merkle root not set");

        merkle::verify_proof(&e, &address, &proof, &merkle_root)
    }

    /// Claim whitelist status (requires valid proof)
    pub fn claim_whitelist(e: Env, address: Address, proof: Vec<BytesN<32>>) {
        address.require_auth();

        if !Self::verify_whitelist(e.clone(), address.clone(), proof) {
            panic!("invalid merkle proof");
        }

        events::emit_whitelist_claimed(&e, &address);
    }

    /// Verify and execute with nonce (prevents replay attacks)
    pub fn verify_with_nonce(
        e: Env,
        address: Address,
        proof: Vec<BytesN<32>>,
        nonce: u64,
    ) -> bool {
        address.require_auth();

        let used_nonces_key = DataKey::Nonce(address.clone());
        let mut used_nonces: Vec<u64> = e
            .storage()
            .persistent()
            .get(&used_nonces_key)
            .unwrap_or(Vec::new(&e));

        for used in used_nonces.iter() {
            if used == nonce {
                panic!("nonce already used");
            }
        }

        if !Self::verify_whitelist(e.clone(), address.clone(), proof) {
            return false;
        }

        used_nonces.push_back(nonce);
        e.storage()
            .persistent()
            .set(&used_nonces_key, &used_nonces);

        events::emit_nonce_used(&e, &address, nonce);
        true
    }

    /// Check if a nonce has been used for an address
    pub fn is_nonce_used(e: Env, address: Address, nonce: u64) -> bool {
        let used_nonces_key = DataKey::Nonce(address);
        let used_nonces: Vec<u64> = e
            .storage()
            .persistent()
            .get(&used_nonces_key)
            .unwrap_or(Vec::new(&e));

        for used in used_nonces.iter() {
            if used == nonce {
                return true;
            }
        }
        false
    }

    /// Get current Merkle root
    pub fn get_merkle_root(e: Env) -> BytesN<32> {
        e.storage()
            .instance()
            .get(&DataKey::Config(ConfigKey::MerkleRoot))
            .expect("merkle root not set")
    }

    /// Get current root version
    pub fn get_root_version(e: Env) -> u32 {
        e.storage()
            .instance()
            .get(&DataKey::Config(ConfigKey::RootVersion))
            .unwrap_or(0)
    }

    /// Get whitelist configuration
    pub fn get_config(e: Env) -> WhitelistConfig {
        let merkle_root: BytesN<32> = e
            .storage()
            .instance()
            .get(&DataKey::Config(ConfigKey::MerkleRoot))
            .expect("merkle root not set");
        let version: u32 = e
            .storage()
            .instance()
            .get(&DataKey::Config(ConfigKey::RootVersion))
            .unwrap_or(0);

        WhitelistConfig {
            merkle_root,
            version,
            updated_at: e.ledger().timestamp(),
        }
    }

    /// Batch verify multiple addresses
    pub fn batch_verify(e: Env, addresses: Vec<Address>, proofs: Vec<Vec<BytesN<32>>>) -> Vec<bool> {
        if addresses.len() != proofs.len() {
            panic!("addresses and proofs length mismatch");
        }

        let merkle_root: BytesN<32> = e
            .storage()
            .instance()
            .get(&DataKey::Config(ConfigKey::MerkleRoot))
            .expect("merkle root not set");

        let mut results = Vec::new(&e);
        for i in 0..addresses.len() {
            let address = addresses.get(i).unwrap();
            let proof = proofs.get(i).unwrap();
            let is_valid = merkle::verify_proof(&e, &address, &proof, &merkle_root);
            results.push_back(is_valid);
        }

        results
    }

    /// Get admin address
    pub fn get_admin(e: Env) -> Address {
        e.storage().instance().get(&DataKey::Config(ConfigKey::Admin)).unwrap()
    }

    /// Transfer admin rights
    pub fn transfer_admin(e: Env, new_admin: Address) {
        let admin: Address = e.storage().instance().get(&DataKey::Config(ConfigKey::Admin)).unwrap();
        admin.require_auth();

        e.storage().instance().set(&DataKey::Config(ConfigKey::Admin), &new_admin);
        events::emit_admin_transferred(&e, &admin, &new_admin);
    }
}
