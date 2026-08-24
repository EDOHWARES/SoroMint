//! Proves that a newer WASM can add storage keys without bricking the
//! keys written by the previous implementation.
//!
//! `ProxyRouterV2` appends `DataKey::StateV2` and copies the genesis
//! counter into it during `migrate`. `DataKey::State` is left untouched.

#![cfg(test)]

use super::{ConfigKey, DataKey, ProxyRouter, ProxyRouterClient, ProxyState};
use soroban_sdk::{
    contract, contractimpl, contracttype, symbol_short, testutils::Address as _, Address, BytesN,
    Env,
};

// ---------------------------------------------------------------------------
// V2 implementation — append-only storage layout
// ---------------------------------------------------------------------------

#[contracttype]
#[derive(Clone)]
enum V2ConfigKey {
    Timelock,
    SchemaVersion,
    ImplVersion,
}

#[contracttype]
#[derive(Clone)]
enum V2DataKey {
    Config(V2ConfigKey),
    State,
    /// NEW in schema 2. Must be appended; never replace `State`.
    StateV2,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ProxyStateV2 {
    pub source_counter: u32,
    pub extra: u32,
}

const V2_SCHEMA: u32 = 2;

#[contract]
pub struct ProxyRouterV2;

#[contractimpl]
impl ProxyRouterV2 {
    pub fn get_counter(e: Env) -> u32 {
        let state: ProxyState = e
            .storage()
            .instance()
            .get(&V2DataKey::State)
            .unwrap_or(ProxyState { counter: 0 });
        state.counter
    }

    pub fn get_state_v2(e: Env) -> ProxyStateV2 {
        e.storage()
            .instance()
            .get(&V2DataKey::StateV2)
            .expect("state v2 missing")
    }

    pub fn get_schema_version(e: Env) -> u32 {
        e.storage()
            .instance()
            .get(&V2DataKey::Config(V2ConfigKey::SchemaVersion))
            .unwrap_or(0)
    }

    pub fn get_version(e: Env) -> u32 {
        e.storage()
            .instance()
            .get(&V2DataKey::Config(V2ConfigKey::ImplVersion))
            .unwrap_or(1)
    }

    pub fn migrate(e: Env) {
        let timelock: Address = e
            .storage()
            .instance()
            .get(&V2DataKey::Config(V2ConfigKey::Timelock))
            .expect("not initialized");
        timelock.require_auth();

        let from: u32 = e
            .storage()
            .instance()
            .get(&V2DataKey::Config(V2ConfigKey::SchemaVersion))
            .unwrap_or(0);

        if from == V2_SCHEMA {
            return;
        }
        if from > V2_SCHEMA {
            panic!("schema downgrade forbidden");
        }

        if from <= 1 {
            let genesis: ProxyState = e
                .storage()
                .instance()
                .get(&V2DataKey::State)
                .unwrap_or(ProxyState { counter: 0 });
            e.storage().instance().set(
                &V2DataKey::StateV2,
                &ProxyStateV2 {
                    source_counter: genesis.counter,
                    extra: 42,
                },
            );
        }

        e.storage()
            .instance()
            .set(&V2DataKey::Config(V2ConfigKey::SchemaVersion), &V2_SCHEMA);
        e.events()
            .publish((symbol_short!("migrated"),), (from, V2_SCHEMA));
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[test]
fn test_v2_migrate_preserves_genesis_keys() {
    let e = Env::default();
    e.mock_all_auths();

    let timelock = Address::generate(&e);
    let proxy_id = e.register(ProxyRouter, ());
    let v1 = ProxyRouterClient::new(&e, &proxy_id);
    v1.initialize(&timelock);
    v1.set_counter(&77);

    assert_eq!(v1.get_counter(), 77);
    assert_eq!(v1.get_schema_version(), 1);

    // Simulate the WASM swap by re-registering V2 at the same contract ID.
    // Storage is keyed by ID, so genesis keys survive.
    e.register_at(&proxy_id, ProxyRouterV2, ());
    let v2 = ProxyRouterV2Client::new(&e, &proxy_id);

    assert_eq!(v2.get_counter(), 77, "genesis State key must still decode");
    assert_eq!(v2.get_schema_version(), 1);

    v2.migrate();

    assert_eq!(v2.get_schema_version(), 2);
    assert_eq!(
        v2.get_counter(),
        77,
        "migrate must not delete DataKey::State"
    );
    let migrated = v2.get_state_v2();
    assert_eq!(migrated.source_counter, 77);
    assert_eq!(migrated.extra, 42);
}

#[test]
fn test_v2_migrate_is_idempotent() {
    let e = Env::default();
    e.mock_all_auths();

    let timelock = Address::generate(&e);
    let proxy_id = e.register(ProxyRouter, ());
    let v1 = ProxyRouterClient::new(&e, &proxy_id);
    v1.initialize(&timelock);
    v1.set_counter(&5);

    e.register_at(&proxy_id, ProxyRouterV2, ());
    let v2 = ProxyRouterV2Client::new(&e, &proxy_id);
    v2.migrate();
    v2.migrate();

    assert_eq!(v2.get_schema_version(), 2);
    assert_eq!(v2.get_state_v2().source_counter, 5);
    assert_eq!(v2.get_counter(), 5);
}

#[test]
fn test_upgrade_then_native_swap_keeps_impl_version_and_state() {
    let e = Env::default();
    e.mock_all_auths();

    let timelock = Address::generate(&e);
    let proxy_id = e.register(ProxyRouter, ());
    let v1 = ProxyRouterClient::new(&e, &proxy_id);
    v1.initialize(&timelock);
    v1.set_counter(&12);
    v1.upgrade(&BytesN::from_array(&e, &[2u8; 32]));
    assert_eq!(v1.get_version(), 2);

    e.register_at(&proxy_id, ProxyRouterV2, ());
    let v2 = ProxyRouterV2Client::new(&e, &proxy_id);
    v2.migrate();

    assert_eq!(v2.get_version(), 2);
    assert_eq!(v2.get_counter(), 12);
    assert_eq!(v2.get_state_v2().source_counter, 12);
}

// Keep the V1 key types referenced so a layout drift in lib.rs fails to compile
// here rather than silently bricking production storage.
#[allow(dead_code)]
fn _layout_lock() {
    let _ = DataKey::State;
    let _ = DataKey::Config(ConfigKey::Timelock);
    let _ = DataKey::Config(ConfigKey::SchemaVersion);
    let _ = DataKey::Config(ConfigKey::ImplVersion);
}
