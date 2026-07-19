//! Multi-signature payload verification helpers for factory deployments.

use soroban_sdk::{
    contracttype, xdr::ToXdr, Address, Bytes, BytesN, Env, String, Vec,
};

/// Ed25519 signature submitted by a registered factory owner.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct OwnerSignature {
    pub public_key: BytesN<32>,
    pub signature: BytesN<64>,
}

/// Canonical deploy parameters that must be signed by owner keys.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct MultisigDeployPayload {
    pub salt: BytesN<32>,
    pub admin: Address,
    pub decimal: u32,
    pub name: String,
    pub symbol: String,
    pub nonce: u64,
}

/// Builds the hash that owners must sign for a multisig deployment.
pub fn build_deploy_payload_hash(e: &Env, payload: &MultisigDeployPayload) -> BytesN<32> {
    let encoded = payload.clone().to_xdr(e);
    e.crypto().sha256(&encoded).into()
}

/// Returns true when `public_key` is present in the registered owner list.
pub fn is_registered_owner(owners: &Vec<BytesN<32>>, public_key: &BytesN<32>) -> bool {
    owners.iter().any(|owner| owner == public_key.clone())
}

/// Verifies owner signatures against `message`, enforcing uniqueness and membership.
///
/// # Panics
/// * `unknown owner` – public key is not registered
/// * `duplicate signature` – same public key appears more than once
/// * host panic from `ed25519_verify` – cryptographic verification failed
///
/// # Returns
/// The list of public keys that produced valid signatures (unique, ordered as provided).
pub fn verify_multisig_signatures(
    e: &Env,
    owners: &Vec<BytesN<32>>,
    message: &Bytes,
    signatures: &Vec<OwnerSignature>,
) -> Vec<BytesN<32>> {
    let mut valid_signers = Vec::new(e);

    for sig in signatures.iter() {
        if !is_registered_owner(owners, &sig.public_key) {
            panic!("unknown owner");
        }

        if valid_signers
            .iter()
            .any(|seen| seen == sig.public_key.clone())
        {
            panic!("duplicate signature");
        }

        e.crypto()
            .ed25519_verify(&sig.public_key, message, &sig.signature);

        valid_signers.push_back(sig.public_key.clone());
    }

    valid_signers
}

/// Ensures the number of unique valid signatures meets the required threshold.
pub fn require_threshold(valid_count: u32, threshold: u32) {
    if threshold == 0 {
        panic!("invalid threshold");
    }
    if valid_count < threshold {
        panic!("insufficient signatures");
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::{testutils::Address as _, vec, BytesN, Env};

    #[test]
    fn test_is_registered_owner() {
        let e = Env::default();
        let k1 = BytesN::from_array(&e, &[1u8; 32]);
        let k2 = BytesN::from_array(&e, &[2u8; 32]);
        let owners = vec![&e, k1.clone(), k2.clone()];

        assert!(is_registered_owner(&owners, &k1));
        assert!(!is_registered_owner(
            &owners,
            &BytesN::from_array(&e, &[3u8; 32])
        ));
    }

    #[test]
    #[should_panic(expected = "insufficient signatures")]
    fn test_require_threshold_fails() {
        require_threshold(1, 2);
    }

    #[test]
    fn test_payload_hash_is_deterministic() {
        let e = Env::default();
        let payload = MultisigDeployPayload {
            salt: BytesN::from_array(&e, &[9u8; 32]),
            admin: Address::generate(&e),
            decimal: 7,
            name: String::from_str(&e, "Token"),
            symbol: String::from_str(&e, "TKN"),
            nonce: 1,
        };

        let h1 = build_deploy_payload_hash(&e, &payload);
        let h2 = build_deploy_payload_hash(&e, &payload);
        assert_eq!(h1, h2);
    }
}
