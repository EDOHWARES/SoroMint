//! # OTC Escrow Contract
//!
//! A trustless escrow for 1-to-1 trades between users, supporting atomic swaps
//! of SMT tokens for other Soroban assets.

#![no_std]

mod events;

#[cfg(test)]
mod test;

use soroban_sdk::{contract, contractimpl, contracttype, token, Address, Env};

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum TradeStatus {
    Pending,
    Completed,
    Cancelled,
    Expired,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Trade {
    pub id: u64,
    pub maker: Address,
    pub taker: Option<Address>,
    pub maker_token: Address,
    pub maker_amount: i128,
    pub taker_token: Address,
    pub taker_amount: i128,
    pub status: TradeStatus,
    pub expiration: u64,
    pub created_at: u64,
}

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Trade(u64),
    TradeCounter,
    Admin,
}

#[contract]
pub struct OTCEscrow;

#[contractimpl]
impl OTCEscrow {
    /// Initialize the contract with an admin
    pub fn initialize(e: Env, admin: Address) {
        if e.storage().instance().has(&DataKey::Admin) {
            panic!("already initialized");
        }
        e.storage().instance().set(&DataKey::Admin, &admin);
        e.storage().instance().set(&DataKey::TradeCounter, &0u64);
    }

    /// Create a new trade offer
    /// The maker deposits their tokens into escrow
    pub fn create_trade(
        e: Env,
        maker: Address,
        maker_token: Address,
        maker_amount: i128,
        taker_token: Address,
        taker_amount: i128,
        expiration_ledgers: u32,
    ) -> u64 {
        maker.require_auth();

        if maker_amount <= 0 || taker_amount <= 0 {
            panic!("amounts must be positive");
        }

        if expiration_ledgers == 0 {
            panic!("expiration must be positive");
        }

        // Transfer maker's tokens to escrow
        let maker_token_client = token::Client::new(&e, &maker_token);
        maker_token_client.transfer(&maker, &e.current_contract_address(), &maker_amount);

        let trade_id: u64 = e
            .storage()
            .instance()
            .get(&DataKey::TradeCounter)
            .unwrap_or(0);
        let next_id = trade_id + 1;

        let current_ledger = e.ledger().sequence();
        let expiration = current_ledger + expiration_ledgers;

        let trade = Trade {
            id: next_id,
            maker: maker.clone(),
            taker: None,
            maker_token: maker_token.clone(),
            maker_amount,
            taker_token: taker_token.clone(),
            taker_amount,
            status: TradeStatus::Pending,
            expiration,
            created_at: e.ledger().timestamp(),
        };

        e.storage()
            .persistent()
            .set(&DataKey::Trade(next_id), &trade);
        e.storage().instance().set(&DataKey::TradeCounter, &next_id);

        events::emit_trade_created(
            &e,
            next_id,
            &maker,
            &maker_token,
            maker_amount,
            &taker_token,
            taker_amount,
            expiration,
        );

        next_id
    }

    /// Accept and execute a trade (atomic swap)
    /// The taker deposits their tokens and both parties receive their counterparty's tokens
    pub fn accept_trade(e: Env, trade_id: u64, taker: Address) {
        taker.require_auth();

        let mut trade: Trade = e
            .storage()
            .persistent()
            .get(&DataKey::Trade(trade_id))
            .expect("trade not found");

        if trade.status != TradeStatus::Pending {
            panic!("trade not pending");
        }

        if e.ledger().sequence() >= trade.expiration {
            panic!("trade expired");
        }

        // Transfer taker's tokens to maker
        let taker_token_client = token::Client::new(&e, &trade.taker_token);
        taker_token_client.transfer(&taker, &trade.maker, &trade.taker_amount);

        // Transfer maker's tokens from escrow to taker
        let maker_token_client = token::Client::new(&e, &trade.maker_token);
        maker_token_client.transfer(&e.current_contract_address(), &taker, &trade.maker_amount);

        // Update trade status
        trade.taker = Some(taker.clone());
        trade.status = TradeStatus::Completed;
        e.storage()
            .persistent()
            .set(&DataKey::Trade(trade_id), &trade);

        events::emit_trade_completed(&e, trade_id, &trade.maker, &taker);
    }

    /// Cancel a pending trade and refund maker's tokens
    /// Only the maker can cancel their own trade
    pub fn cancel_trade(e: Env, trade_id: u64) {
        let mut trade: Trade = e
            .storage()
            .persistent()
            .get(&DataKey::Trade(trade_id))
            .expect("trade not found");

        trade.maker.require_auth();

        if trade.status != TradeStatus::Pending {
            panic!("trade not pending");
        }

        // Refund maker's tokens
        let maker_token_client = token::Client::new(&e, &trade.maker_token);
        maker_token_client.transfer(
            &e.current_contract_address(),
            &trade.maker,
            &trade.maker_amount,
        );

        // Update trade status
        trade.status = TradeStatus::Cancelled;
        e.storage()
            .persistent()
            .set(&DataKey::Trade(trade_id), &trade);

        events::emit_trade_cancelled(&e, trade_id, &trade.maker);
    }

    /// Claim refund for an expired trade
    /// Anyone can call this after expiration to return funds to maker
    pub fn claim_expired(e: Env, trade_id: u64) {
        let mut trade: Trade = e
            .storage()
            .persistent()
            .get(&DataKey::Trade(trade_id))
            .expect("trade not found");

        if trade.status != TradeStatus::Pending {
            panic!("trade not pending");
        }

        if e.ledger().sequence() < trade.expiration {
            panic!("trade not expired yet");
        }

        // Refund maker's tokens
        let maker_token_client = token::Client::new(&e, &trade.maker_token);
        maker_token_client.transfer(
            &e.current_contract_address(),
            &trade.maker,
            &trade.maker_amount,
        );

        // Update trade status
        trade.status = TradeStatus::Expired;
        e.storage()
            .persistent()
            .set(&DataKey::Trade(trade_id), &trade);

        events::emit_trade_expired(&e, trade_id, &trade.maker);
    }

    /// Get trade details
    pub fn get_trade(e: Env, trade_id: u64) -> Trade {
        e.storage()
            .persistent()
            .get(&DataKey::Trade(trade_id))
            .expect("trade not found")
    }

    /// Check if a trade is still active (pending and not expired)
    pub fn is_active(e: Env, trade_id: u64) -> bool {
        let trade: Trade = e
            .storage()
            .persistent()
            .get(&DataKey::Trade(trade_id))
            .expect("trade not found");

        trade.status == TradeStatus::Pending && e.ledger().sequence() < trade.expiration
    }
}
