#![cfg(test)]

use super::*;
use soroban_sdk::{testutils::Address as _, Address, Bytes, BytesN, Env};

// The contract crate is `#![no_std]`; bring `std` into scope so the fuzz tests
// below can use `std::panic::catch_unwind` and `std::vec!` (same pattern as
// `contracts/lending_pool/src/test.rs` and `contracts/zk_mint_gateway/src/test.rs`).
extern crate std;

/// Test harness for the Bridge Receiver contract.
///
/// Mirrors the `Rig` pattern used by `contracts/lending_pool/src/test.rs` and
/// `contracts/zk_mint_gateway/src/test.rs`: register the contract once and hand
/// out short-lived clients on demand.
///
/// All state access goes through the generated [`BridgeReceiverContractClient`]
/// because the soroban-sdk test `Env` only exposes storage to the currently
/// running contract; the raw free functions in `bridge_receiver.rs` cannot be
/// called directly without an active contract frame.
struct Rig {
    env: Env,
    admin: Address,
    contract_id: Address,
}

impl Rig {
    /// Creates a fresh `Env`, registers the contract, initializes it with a
    /// freshly generated admin, and mocks all auth.
    fn setup() -> Self {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let contract_id = env.register(BridgeReceiverContract, ());

        let client = BridgeReceiverContractClient::new(&env, &contract_id);
        let token_contract = Address::generate(&env);
        client.initialize(&admin, &token_contract);

        Rig {
            env,
            admin,
            contract_id,
        }
    }

    /// Returns a client bound to this rig's `Env` and contract.
    fn client(&self) -> BridgeReceiverContractClient<'_> {
        BridgeReceiverContractClient::new(&self.env, &self.contract_id)
    }
}

#[test]
fn test_initialize() {
    let rig = Rig::setup();
    let client = rig.client();

    assert!(client.is_relayer(&rig.admin));
    assert_eq!(client.get_signal_count(), 0);
    assert!(!client.is_paused());
}

#[test]
fn test_pause_unpause() {
    let rig = Rig::setup();
    let client = rig.client();

    client.pause(&rig.admin);
    assert!(client.is_paused());

    client.unpause(&rig.admin);
    assert!(!client.is_paused());
}

#[test]
fn test_add_remove_relayer() {
    let rig = Rig::setup();
    let client = rig.client();

    let relayer = Address::generate(&rig.env);
    client.add_relayer(&rig.admin, &relayer);
    assert!(client.is_relayer(&relayer));

    client.remove_relayer(&rig.admin, &relayer);
    assert!(!client.is_relayer(&relayer));
}

#[test]
fn test_receive_mint_signal() {
    let rig = Rig::setup();
    let client = rig.client();

    let recipient = Address::generate(&rig.env);
    let source_tx_hash = BytesN::from_array(&rig.env, &[1u8; 32]);
    let verification_proof = Bytes::from_array(&rig.env, &[2u8; 64]);

    let signal_id = client.receive_mint_signal(
        &rig.admin,
        &SourceChain::Ethereum,
        &source_tx_hash,
        &recipient,
        &1000i128,
        &1u64,
        &verification_proof,
    );

    assert_eq!(signal_id, 0);
    assert_eq!(client.get_signal_count(), 1);

    let signal = client.get_signal(&signal_id).unwrap();
    assert_eq!(signal.signal_id, 0);
    assert_eq!(signal.recipient, recipient);
    assert_eq!(signal.amount, 1000);
    assert_eq!(signal.status, BridgeStatus::Pending);
}

#[test]
fn test_execute_mint_signal() {
    let rig = Rig::setup();
    let client = rig.client();

    let recipient = Address::generate(&rig.env);
    let source_tx_hash = BytesN::from_array(&rig.env, &[1u8; 32]);
    let verification_proof = Bytes::from_array(&rig.env, &[2u8; 64]);

    let signal_id = client.receive_mint_signal(
        &rig.admin,
        &SourceChain::Ethereum,
        &source_tx_hash,
        &recipient,
        &1000i128,
        &1u64,
        &verification_proof,
    );

    let success = client.execute_mint_signal(&rig.admin, &signal_id);
    assert!(success);

    let signal = client.get_signal(&signal_id).unwrap();
    assert_eq!(signal.status, BridgeStatus::Executed);

    // Check that transaction is marked as processed
    assert!(client.is_tx_processed(&source_tx_hash));
}

#[test]
#[should_panic(expected = "Transaction already processed")]
fn test_replay_protection() {
    let rig = Rig::setup();
    let client = rig.client();

    let recipient = Address::generate(&rig.env);
    let source_tx_hash = BytesN::from_array(&rig.env, &[1u8; 32]);
    let verification_proof = Bytes::from_array(&rig.env, &[2u8; 64]);

    // First signal
    let signal_id = client.receive_mint_signal(
        &rig.admin,
        &SourceChain::Ethereum,
        &source_tx_hash,
        &recipient,
        &1000i128,
        &1u64,
        &verification_proof,
    );

    client.execute_mint_signal(&rig.admin, &signal_id);

    // Try to submit same transaction again - should panic
    client.receive_mint_signal(
        &rig.admin,
        &SourceChain::Ethereum,
        &source_tx_hash,
        &recipient,
        &1000i128,
        &2u64,
        &verification_proof,
    );
}

#[test]
#[should_panic(expected = "Contract is paused")]
fn test_paused_receive_signal() {
    let rig = Rig::setup();
    let client = rig.client();

    client.pause(&rig.admin);

    let recipient = Address::generate(&rig.env);
    let source_tx_hash = BytesN::from_array(&rig.env, &[1u8; 32]);
    let verification_proof = Bytes::from_array(&rig.env, &[2u8; 64]);

    // Should panic because contract is paused
    client.receive_mint_signal(
        &rig.admin,
        &SourceChain::Ethereum,
        &source_tx_hash,
        &recipient,
        &1000i128,
        &1u64,
        &verification_proof,
    );
}

#[test]
#[should_panic(expected = "Invalid amount")]
fn test_invalid_amount() {
    let rig = Rig::setup();
    let client = rig.client();

    let recipient = Address::generate(&rig.env);
    let source_tx_hash = BytesN::from_array(&rig.env, &[1u8; 32]);
    let verification_proof = Bytes::from_array(&rig.env, &[2u8; 64]);

    // Should panic with invalid amount
    client.receive_mint_signal(
        &rig.admin,
        &SourceChain::Ethereum,
        &source_tx_hash,
        &recipient,
        &0i128, // Invalid amount
        &1u64,
        &verification_proof,
    );
}

#[test]
fn test_get_signals() {
    let rig = Rig::setup();
    let client = rig.client();

    let recipient = Address::generate(&rig.env);

    // Create multiple signals
    for i in 0..5 {
        let source_tx_hash = BytesN::from_array(&rig.env, &[i as u8; 32]);
        let verification_proof = Bytes::from_array(&rig.env, &[i as u8; 64]);

        client.receive_mint_signal(
            &rig.admin,
            &SourceChain::Ethereum,
            &source_tx_hash,
            &recipient,
            &(1000 * (i as i128 + 1)),
            &(i as u64),
            &verification_proof,
        );
    }

    assert_eq!(client.get_signal_count(), 5);

    // Get signals 0-3
    let signals = client.get_signals(&0u64, &3u32);
    assert_eq!(signals.len(), 3);
    assert_eq!(signals.get(0).unwrap().signal_id, 0);
    assert_eq!(signals.get(2).unwrap().signal_id, 2);
}

#[test]
#[should_panic(expected = "Unauthorized: not a relayer")]
fn test_unauthorized_relayer() {
    let rig = Rig::setup();
    let client = rig.client();

    let unauthorized = Address::generate(&rig.env);
    let recipient = Address::generate(&rig.env);
    let source_tx_hash = BytesN::from_array(&rig.env, &[1u8; 32]);
    let verification_proof = Bytes::from_array(&rig.env, &[2u8; 64]);

    // Should panic - unauthorized relayer
    client.receive_mint_signal(
        &unauthorized,
        &SourceChain::Ethereum,
        &source_tx_hash,
        &recipient,
        &1000i128,
        &1u64,
        &verification_proof,
    );
}

// --- Fuzz testing (Issue #751: Add Fuzz Testing for Bridge Receiver Contract) ---
//
// These property tests generate randomized *valid* and *invalid* inputs for the
// core state-changing functions and verify that the contract either succeeds,
// panics gracefully, or returns the expected error - never corrupting state.

use proptest::prelude::*;
use std::panic::{catch_unwind, AssertUnwindSafe};

/// Intermediate representation used to generate every `SourceChain` variant
/// (including `Other`) without needing an `Env` inside the strategy. `Other`
/// holds a `std::string::String` because `soroban_sdk::String` cannot be
/// constructed without an `Env`.
#[derive(Clone, Debug)]
enum ChainSpec {
    Named(SourceChain),
    Other(std::string::String),
}

/// Strategy producing every `SourceChain` variant (including `Other`) so the
/// storage round-trip is exercised for each one. The `Other` raw string is
/// size-bounded so the fuzz cases stay cheap.
fn any_source_chain() -> impl Strategy<Value = ChainSpec> {
    prop_oneof![
        Just(ChainSpec::Named(SourceChain::Ethereum)),
        Just(ChainSpec::Named(SourceChain::BinanceSmartChain)),
        Just(ChainSpec::Named(SourceChain::Polygon)),
        Just(ChainSpec::Named(SourceChain::Avalanche)),
        Just(ChainSpec::Named(SourceChain::Arbitrum)),
        Just(ChainSpec::Named(SourceChain::Optimism)),
        Just(ChainSpec::Named(SourceChain::Base)),
        proptest::collection::vec(any::<char>(), 0..64)
            .prop_map(|cs| cs.into_iter().collect::<std::string::String>())
            .prop_map(ChainSpec::Other),
    ]
}

/// Materializes a generated [`ChainSpec`] into a concrete [`SourceChain`].
fn materialize_source_chain(env: &Env, spec: ChainSpec) -> SourceChain {
    match spec {
        ChainSpec::Named(chain) => chain,
        ChainSpec::Other(raw) => SourceChain::Other(String::from_str(env, &raw)),
    }
}

proptest! {
    #![proptest_config(ProptestConfig::with_cases(64))]

    // Fuzz: receive_mint_signal with randomized valid and invalid inputs.
    //
    // - Positive amounts must produce a stored, pending signal whose fields
    //   round-trip exactly.
    // - Non-positive amounts must panic with "Invalid amount" and must not
    //   advance the signal counter (no state corruption).
    #[test]
    fn prop_fuzz_receive_mint_signal(
        source_chain_spec in any_source_chain(),
        amount in any::<i128>(),
        nonce in any::<u64>(),
        source_tx_hash in any::<[u8; 32]>(),
        proof_len in 0usize..256,
        proof_byte in any::<u8>(),
    ) {
        let rig = Rig::setup();
        let client = rig.client();
        let source_chain = materialize_source_chain(&rig.env, source_chain_spec);

        let recipient = Address::generate(&rig.env);
        let count_before = client.get_signal_count();

        let hash = BytesN::from_array(&rig.env, &source_tx_hash);
        let proof = Bytes::from_slice(&rig.env, &std::vec![proof_byte; proof_len]);

        let result = catch_unwind(AssertUnwindSafe(|| {
            client.receive_mint_signal(
                &rig.admin,
                &source_chain,
                &hash,
                &recipient,
                &amount,
                &nonce,
                &proof,
            )
        }));

        if amount <= 0 {
            // Invalid amount: the contract panics instead of storing a signal.
            prop_assert!(result.is_err(), "expected panic for amount {amount}");
            prop_assert_eq!(client.get_signal_count(), count_before);
        } else {
            // Valid amount: exactly one signal is appended with matching fields.
            let signal_id = result.expect("expected successful receive");
            prop_assert_eq!(signal_id, count_before);
            prop_assert_eq!(client.get_signal_count(), count_before + 1);

            let signal = client.get_signal(&signal_id).unwrap();
            prop_assert_eq!(signal.signal_id, signal_id);
            prop_assert_eq!(signal.amount, amount);
            prop_assert_eq!(signal.nonce, nonce);
            prop_assert_eq!(signal.recipient, recipient);
            prop_assert_eq!(signal.source_chain, source_chain);
            prop_assert_eq!(signal.status, BridgeStatus::Pending);
        }
    }

    // Fuzz: execute_mint_signal on a valid signal and on nonexistent ids.
    //
    // - signal_id == 0 (the id of the freshly created signal): execution either
    //   succeeds (non-empty proof -> Executed, tx marked processed) or fails
    //   verification (empty proof -> Failed, tx NOT processed). In both cases
    //   the stored status stays consistent.
    // - signal_id 1..4 (nonexistent): the contract panics with "Signal not
    //   found" and the registry is left untouched.
    #[test]
    fn prop_fuzz_execute_mint_signal(
        signal_id in 0u64..4u64,
        amount in 1i128..=i128::MAX,
        proof_len in 0usize..64,
    ) {
        let rig = Rig::setup();
        let client = rig.client();

        let recipient = Address::generate(&rig.env);
        let hash = BytesN::from_array(&rig.env, &[1u8; 32]);
        let proof = Bytes::from_slice(&rig.env, &std::vec![7u8; proof_len]);

        let created_id = client.receive_mint_signal(
            &rig.admin,
            &SourceChain::Ethereum,
            &hash,
            &recipient,
            &amount,
            &0u64,
            &proof,
        );
        prop_assert_eq!(created_id, 0);

        if signal_id == created_id {
            // Valid pending signal.
            let ok = client.execute_mint_signal(&rig.admin, &signal_id);
            let signal = client.get_signal(&signal_id).unwrap();
            if proof_len > 0 {
                // Non-empty proof verifies -> executed and tx marked processed.
                prop_assert!(ok, "non-empty proof should execute");
                prop_assert_eq!(signal.status, BridgeStatus::Executed);
                prop_assert!(client.is_tx_processed(&signal.source_tx_hash));
            } else {
                // Empty proof fails verification -> failed, tx NOT processed.
                prop_assert!(!ok, "empty proof should fail verification");
                prop_assert_eq!(signal.status, BridgeStatus::Failed);
                prop_assert!(!client.is_tx_processed(&signal.source_tx_hash));
            }
        } else {
            // Nonexistent signal: panic gracefully, registry untouched.
            let res = catch_unwind(AssertUnwindSafe(|| {
                client.execute_mint_signal(&rig.admin, &signal_id)
            }));
            prop_assert!(res.is_err(), "expected panic for missing signal");
            prop_assert_eq!(client.get_signal_count(), 1);
            let signal = client.get_signal(&created_id).unwrap();
            prop_assert_eq!(signal.status, BridgeStatus::Pending);
        }
    }

    // Fuzz: re-executing a signal (replay) panics and preserves final status.
    #[test]
    fn prop_fuzz_execute_replay(amount in 1i128..=i128::MAX) {
        let rig = Rig::setup();
        let client = rig.client();

        let recipient = Address::generate(&rig.env);
        let hash = BytesN::from_array(&rig.env, &[3u8; 32]);
        let proof = Bytes::from_array(&rig.env, &[4u8; 32]);

        let signal_id = client.receive_mint_signal(
            &rig.admin,
            &SourceChain::Ethereum,
            &hash,
            &recipient,
            &amount,
            &42u64,
            &proof,
        );

        prop_assert!(client.execute_mint_signal(&rig.admin, &signal_id));

        // Second execution must panic and not corrupt the stored signal.
        let res = catch_unwind(AssertUnwindSafe(|| {
            client.execute_mint_signal(&rig.admin, &signal_id)
        }));
        prop_assert!(res.is_err(), "replay must panic");
        let signal = client.get_signal(&signal_id).unwrap();
        prop_assert_eq!(signal.status, BridgeStatus::Executed);
    }

    // Fuzz: add_relayer / remove_relayer with randomized relayer addresses.
    #[test]
    fn prop_fuzz_add_remove_relayer(_seed in any::<u64>()) {
        let rig = Rig::setup();
        let client = rig.client();

        let relayer_a = Address::generate(&rig.env);
        let relayer_b = Address::generate(&rig.env);
        if relayer_a == relayer_b {
            return Ok(());
        }

        // Adding an already-authorized relayer is idempotent.
        client.add_relayer(&rig.admin, &relayer_a);
        prop_assert!(client.is_relayer(&relayer_a));
        client.add_relayer(&rig.admin, &relayer_a);
        prop_assert!(client.is_relayer(&relayer_a));

        // Unauthorized addresses are not relayers.
        prop_assert!(!client.is_relayer(&relayer_b));

        // Removing a relayer revokes authorization.
        client.remove_relayer(&rig.admin, &relayer_a);
        prop_assert!(!client.is_relayer(&relayer_a));

        // Admin remains a relayer throughout.
        prop_assert!(client.is_relayer(&rig.admin));

        // Non-admin cannot mutate the relayer registry.
        let impostor = Address::generate(&rig.env);
        if impostor == rig.admin {
            return Ok(());
        }
        let res = catch_unwind(AssertUnwindSafe(|| {
            client.add_relayer(&impostor, &relayer_b)
        }));
        prop_assert!(res.is_err(), "non-admin add_relayer must panic");
        prop_assert!(!client.is_relayer(&relayer_b));
    }

    // Fuzz: pause / unpause behavior with randomized inputs.
    #[test]
    fn prop_fuzz_pause_unpause(amount in 1i128..=i128::MAX) {
        let rig = Rig::setup();
        let client = rig.client();

        // Pausing is idempotent.
        client.pause(&rig.admin);
        prop_assert!(client.is_paused());
        client.pause(&rig.admin);
        prop_assert!(client.is_paused());

        // While paused, receive_mint_signal panics and state is unchanged.
        let count_before = client.get_signal_count();
        let recipient = Address::generate(&rig.env);
        let hash = BytesN::from_array(&rig.env, &[9u8; 32]);
        let proof = Bytes::from_array(&rig.env, &[1u8; 32]);
        let res = catch_unwind(AssertUnwindSafe(|| {
            client.receive_mint_signal(
                &rig.admin,
                &SourceChain::Ethereum,
                &hash,
                &recipient,
                &amount,
                &0u64,
                &proof,
            )
        }));
        prop_assert!(res.is_err(), "paused contract must reject signals");
        prop_assert_eq!(client.get_signal_count(), count_before);

        // Unauthorized unpause panics and leaves the contract paused.
        let impostor = Address::generate(&rig.env);
        if impostor != rig.admin {
            let res = catch_unwind(AssertUnwindSafe(|| {
                client.unpause(&impostor)
            }));
            prop_assert!(res.is_err(), "non-admin unpause must panic");
            prop_assert!(client.is_paused());
        }

        // Unpausing is idempotent and restores operations.
        client.unpause(&rig.admin);
        prop_assert!(!client.is_paused());
        client.unpause(&rig.admin);
        prop_assert!(!client.is_paused());
    }

    // Fuzz: get_signals with randomized ranges never panics and respects bounds.
    #[test]
    fn prop_fuzz_get_signals(start_id in any::<u64>(), limit in any::<u32>()) {
        let rig = Rig::setup();
        let client = rig.client();

        // Seed 7 signals with distinct hashes.
        for i in 0..7u8 {
            let hash = BytesN::from_array(&rig.env, &[i; 32]);
            let proof = Bytes::from_array(&rig.env, &[i; 32]);
            let recipient = Address::generate(&rig.env);
            client.receive_mint_signal(
                &rig.admin,
                &SourceChain::Ethereum,
                &hash,
                &recipient,
                &((i as i128) + 1),
                &(i as u64),
                &proof,
            );
        }
        prop_assert_eq!(client.get_signal_count(), 7);

        // Must never panic, regardless of start_id/limit (overflow-safe range
        // computation in the contract via saturating_add / min).
        let signals = client.get_signals(&start_id, &limit);

        // Returned signals always belong to the stored range.
        for sig in signals.iter() {
            prop_assert!(sig.signal_id < 7);
            prop_assert!(sig.signal_id >= start_id);
        }
        // Result length is bounded by both limit and total count.
        prop_assert!(signals.len() as u64 <= limit as u64);
        prop_assert!(signals.len() as u64 <= 7);
    }
}
