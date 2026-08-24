//! Cross-contract governance lifecycle:
//! MultiSig propose → approve → execute (queue) → 48h delay → Timelock execute
//! → ProxyRouter.upgrade (WASM hash) + migrate.

#![cfg(test)]

use super::*;
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    vec, Address, BytesN, Env,
};
use soromint_multisig::{MultiSigAdmin, MultiSigAdminClient};
use soromint_timelock::{FactoryOperation, TimelockContract, TimelockContractClient};

const DELAY: u64 = 48 * 60 * 60;

fn dummy_hash(e: &Env, seed: u8) -> BytesN<32> {
    BytesN::from_array(e, &[seed; 32])
}

struct Harness {
    e: Env,
    signer1: Address,
    signer2: Address,
    signer3: Address,
    multisig: MultiSigAdminClient<'static>,
    timelock: TimelockContractClient<'static>,
    timelock_id: Address,
    proxy: ProxyRouterClient<'static>,
    proxy_id: Address,
}

fn setup() -> Harness {
    let e = Env::default();
    e.mock_all_auths();

    let signer1 = Address::generate(&e);
    let signer2 = Address::generate(&e);
    let signer3 = Address::generate(&e);

    let multisig_id = e.register(MultiSigAdmin, ());
    let multisig = MultiSigAdminClient::new(&e, &multisig_id);
    multisig.initialize(
        &vec![&e, signer1.clone(), signer2.clone(), signer3.clone()],
        &2,
    );

    let timelock_id = e.register(TimelockContract, ());
    let timelock = TimelockContractClient::new(&e, &timelock_id);
    timelock.initialize(&multisig_id);

    let proxy_id = e.register(ProxyRouter, ());
    let proxy = ProxyRouterClient::new(&e, &proxy_id);
    proxy.initialize(&timelock_id);

    Harness {
        e,
        signer1,
        signer2,
        signer3,
        multisig,
        timelock,
        timelock_id,
        proxy,
        proxy_id,
    }
}

#[test]
fn test_full_governance_upgrade_lifecycle() {
    let h = setup();
    h.proxy.set_counter(&99);

    let new_hash = dummy_hash(&h.e, 9);
    let tx_id = h
        .multisig
        .propose_upgrade(&h.signer1, &h.timelock_id, &h.proxy_id, &new_hash);
    assert_eq!(tx_id, 1);

    let proposal = h.multisig.get_upgrade(&tx_id);
    assert_eq!(proposal.proxy, h.proxy_id);
    assert_eq!(proposal.wasm_hash, new_hash);
    assert_eq!(proposal.queued, false);
    assert_eq!(proposal.signatures.len(), 1);

    h.multisig.approve_upgrade(&h.signer2, &tx_id);
    assert_eq!(h.multisig.get_upgrade(&tx_id).signatures.len(), 2);

    let eta = h.e.ledger().timestamp() + DELAY;
    h.multisig.execute_upgrade(&h.signer1, &tx_id);
    assert_eq!(h.multisig.get_upgrade(&tx_id).queued, true);

    let op = FactoryOperation::UpgradeProxy(h.proxy_id.clone(), new_hash.clone());
    assert!(h.timelock.get_operation_eta(&op, &eta).is_some());

    h.e.ledger().with_mut(|l| l.timestamp += DELAY + 1);
    h.timelock.execute_upgrade(&h.proxy_id, &new_hash, &eta);

    assert_eq!(h.proxy.get_version(), 2);
    assert_eq!(h.proxy.get_counter(), 99);
    assert_eq!(h.proxy.get_schema_version(), 1);
    assert!(h.timelock.get_operation_eta(&op, &eta).is_none());
}

#[test]
#[should_panic(expected = "timelock delay not elapsed")]
fn test_execute_before_48h_panics() {
    let h = setup();
    let new_hash = dummy_hash(&h.e, 4);

    let tx_id = h
        .multisig
        .propose_upgrade(&h.signer1, &h.timelock_id, &h.proxy_id, &new_hash);
    h.multisig.approve_upgrade(&h.signer2, &tx_id);
    h.multisig.execute_upgrade(&h.signer1, &tx_id);

    let eta = h.e.ledger().timestamp() + DELAY;
    h.e.ledger().with_mut(|l| l.timestamp += 3600);
    h.timelock.execute_upgrade(&h.proxy_id, &new_hash, &eta);
}

#[test]
#[should_panic(expected = "insufficient signatures")]
fn test_execute_upgrade_without_threshold_panics() {
    let h = setup();
    let new_hash = dummy_hash(&h.e, 5);
    let tx_id = h
        .multisig
        .propose_upgrade(&h.signer1, &h.timelock_id, &h.proxy_id, &new_hash);
    h.multisig.execute_upgrade(&h.signer1, &tx_id);
}

#[test]
#[should_panic(expected = "not a signer")]
fn test_unauthorized_propose_upgrade_panics() {
    let h = setup();
    let stranger = Address::generate(&h.e);
    h.multisig
        .propose_upgrade(&stranger, &h.timelock_id, &h.proxy_id, &dummy_hash(&h.e, 6));
}

#[test]
#[should_panic(expected = "target mismatch")]
fn test_execute_with_wrong_proxy_panics() {
    let h = setup();
    let new_hash = dummy_hash(&h.e, 7);
    let tx_id = h
        .multisig
        .propose_upgrade(&h.signer1, &h.timelock_id, &h.proxy_id, &new_hash);
    h.multisig.approve_upgrade(&h.signer2, &tx_id);
    h.multisig.execute_upgrade(&h.signer1, &tx_id);

    let eta = h.e.ledger().timestamp() + DELAY;
    h.e.ledger().with_mut(|l| l.timestamp += DELAY + 1);

    let other = Address::generate(&h.e);
    h.timelock.execute_operation(
        &other,
        &FactoryOperation::UpgradeProxy(h.proxy_id.clone(), new_hash),
        &eta,
    );
}

#[test]
fn test_third_signer_not_required_when_threshold_met() {
    let h = setup();
    let new_hash = dummy_hash(&h.e, 8);
    let tx_id = h
        .multisig
        .propose_upgrade(&h.signer1, &h.timelock_id, &h.proxy_id, &new_hash);
    h.multisig.approve_upgrade(&h.signer3, &tx_id);
    h.multisig.execute_upgrade(&h.signer2, &tx_id);
    assert!(h.multisig.get_upgrade(&tx_id).queued);
}
