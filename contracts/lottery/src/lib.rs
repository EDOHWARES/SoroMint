//! # SoroMint VRF Lottery Contract
//!
//! A fair, transparent lottery for token holders. The admin seeds a VRF
//! commitment; after the reveal the winner is selected deterministically from
//! the participant list using the revealed randomness.
//!
//! ## Flow
//! 1. Admin calls `initialize` with ticket price and token address.
//! 2. Admin calls `commit_vrf(hash)` to commit to a secret random value.
//! 3. Token holders call `enter` to buy a ticket (token transfer required).
//! 4. Admin calls `reveal_vrf(secret)` — verifies hash, picks winner, pays out.

#![no_std]

#[cfg(test)]
mod test;

use soroban_sdk::{
    contract, contractimpl, contracttype, symbol_short, token, Address, BytesN, Env, String, Vec,
};

// ---------------------------------------------------------------------------
// Storage keys
// ---------------------------------------------------------------------------

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Admin,
    Token,
    TicketPrice,
    Participants,
    VrfCommit,
    Winner,
    Ended,
}

// ---------------------------------------------------------------------------
// Contract
// ---------------------------------------------------------------------------

#[contract]
pub struct Lottery;

#[contractimpl]
impl Lottery {
    /// One-time setup: set admin, prize token, and ticket price.
    pub fn initialize(e: Env, admin: Address, token: Address, ticket_price: i128) {
        if e.storage().instance().has(&DataKey::Admin) {
            panic!("already initialized");
        }
        admin.require_auth();
        e.storage().instance().set(&DataKey::Admin, &admin);
        e.storage().instance().set(&DataKey::Token, &token);
        e.storage()
            .instance()
            .set(&DataKey::TicketPrice, &ticket_price);
        e.storage()
            .instance()
            .set(&DataKey::Ended, &false);
        e.storage()
            .persistent()
            .set(&DataKey::Participants, &Vec::<Address>::new(&e));
    }

    /// Admin commits to a VRF secret by storing its SHA-256 hash.
    pub fn commit_vrf(e: Env, commit_hash: BytesN<32>) {
        Self::require_admin(&e);
        if e.storage().instance().has(&DataKey::VrfCommit) {
            panic!("already committed");
        }
        e.storage()
            .instance()
            .set(&DataKey::VrfCommit, &commit_hash);
        e.events()
            .publish((symbol_short!("vrf_comm"),), commit_hash);
    }

    /// Token holder enters the lottery by paying the ticket price.
    pub fn enter(e: Env, participant: Address) {
        participant.require_auth();
        if !e.storage().instance().has(&DataKey::VrfCommit) {
            panic!("vrf not committed");
        }
        let ended: bool = e.storage().instance().get(&DataKey::Ended).unwrap();
        if ended {
            panic!("lottery ended");
        }

        let price: i128 = e
            .storage()
            .instance()
            .get(&DataKey::TicketPrice)
            .unwrap();
        let tok: Address = e.storage().instance().get(&DataKey::Token).unwrap();
        token::Client::new(&e, &tok).transfer(&participant, &e.current_contract_address(), &price);

        let mut participants: Vec<Address> = e
            .storage()
            .persistent()
            .get(&DataKey::Participants)
            .unwrap();
        participants.push_back(participant.clone());
        e.storage()
            .persistent()
            .set(&DataKey::Participants, &participants);

        e.events()
            .publish((symbol_short!("entered"),), participant);
    }

    /// Admin reveals the VRF secret, verifies the commitment, picks winner, pays out.
    pub fn reveal_vrf(e: Env, secret: BytesN<32>) {
        Self::require_admin(&e);
        let ended: bool = e.storage().instance().get(&DataKey::Ended).unwrap();
        if ended {
            panic!("lottery ended");
        }

        // Verify commitment: sha256(secret) == stored hash
        let committed: BytesN<32> = e
            .storage()
            .instance()
            .get(&DataKey::VrfCommit)
            .expect("no commitment");
        let digest = e.crypto().sha256(&secret.into());
        if digest != committed {
            panic!("vrf secret mismatch");
        }

        let participants: Vec<Address> = e
            .storage()
            .persistent()
            .get(&DataKey::Participants)
            .unwrap();
        if participants.is_empty() {
            panic!("no participants");
        }

        // Derive winner index from secret bytes (first 8 bytes as u64)
        let secret_bytes = secret.to_array();
        let mut idx_bytes = [0u8; 8];
        idx_bytes.copy_from_slice(&secret_bytes[..8]);
        let rand_val = u64::from_be_bytes(idx_bytes);
        let winner_idx = (rand_val % participants.len() as u64) as u32;
        let winner = participants.get(winner_idx).unwrap();

        // Transfer entire prize pool to winner
        let tok: Address = e.storage().instance().get(&DataKey::Token).unwrap();
        let price: i128 = e.storage().instance().get(&DataKey::TicketPrice).unwrap();
        let prize = price * participants.len() as i128;
        token::Client::new(&e, &tok).transfer(&e.current_contract_address(), &winner, &prize);

        e.storage().instance().set(&DataKey::Winner, &winner);
        e.storage().instance().set(&DataKey::Ended, &true);

        e.events()
            .publish((symbol_short!("winner"),), winner);
    }

    pub fn get_winner(e: Env) -> Address {
        e.storage()
            .instance()
            .get(&DataKey::Winner)
            .expect("no winner yet")
    }

    pub fn get_participants(e: Env) -> Vec<Address> {
        e.storage()
            .persistent()
            .get(&DataKey::Participants)
            .unwrap_or(Vec::new(&e))
    }

    pub fn version(_e: Env) -> String {
        String::from_str(&_e, "1.0.0")
    }

    // -----------------------------------------------------------------------
    // Helpers
    // -----------------------------------------------------------------------

    fn require_admin(e: &Env) {
        let admin: Address = e.storage().instance().get(&DataKey::Admin).unwrap();
        admin.require_auth();
    }
}
