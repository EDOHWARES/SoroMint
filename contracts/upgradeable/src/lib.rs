//! # SoroMint Proxy Router
//!
//! Unified upgradeable proxy whose contract ID and persistent storage stay
//! fixed while the WASM implementation can be replaced in-place.
//!
//! Upgrades are not EOA/admin-gated. The only address that can authorize
//! `upgrade` / `migrate` is the Timelock contract, which itself only
//! executes operations that were proposed by the MultiSig and have sat in
//! the 48-hour delay queue.
//!
//! ## Governance state machine
//! 1. A MultiSig signer proposes an upgrade (`propose_upgrade`).
//! 2. Signers approve until the threshold is met (`approve_upgrade`).
//! 3. Execution queues the operation on the Timelock (`execute_upgrade`).
//! 4. After 48 hours anyone may execute; the Timelock calls this proxy.
//! 5. `upgrade` swaps the WASM hash; `migrate` applies additive schema changes.
//!
//! ## Storage safety
//! `ConfigKey` and `DataKey` are **append-only**. Never reorder, rename, or
//! remove variants — doing so bricks existing keys. New implementations add
//! variants at the end and copy data forward in `migrate`. Old keys are never
//! deleted.

#![no_std]

#[cfg(test)]
mod test;
#[cfg(test)]
mod test_governance;
#[cfg(test)]
mod test_migration;

use soroban_sdk::{
    contract, contractimpl, contracttype, symbol_short, Address, BytesN, Env, String,
};

// ---------------------------------------------------------------------------
// Storage keys — APPEND-ONLY. New variants go at the end of each enum.
// ---------------------------------------------------------------------------

#[contracttype]
#[derive(Clone)]
pub enum ConfigKey {
    /// The Timelock contract that is the sole authorized upgrader.
    Timelock,
    /// Storage schema version. Incremented only by `migrate`.
    SchemaVersion,
    /// Count of successful WASM replacements (implementation version).
    ImplVersion,
}

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Config(ConfigKey),
    /// Application payload for this implementation. Later WASM revisions
    /// MUST keep this variant in this position so existing values remain
    /// readable. New data belongs in new variants (e.g. `StateV2`).
    State,
}

/// Genesis application state. This struct is frozen: never add, remove, or
/// reorder fields. Evolve via a new `DataKey` variant instead.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ProxyState {
    pub counter: u32,
}

/// Schema version implemented by this WASM. Future revisions bump this and
/// teach `migrate` how to walk from older schemas without touching old keys.
const SCHEMA_VERSION: u32 = 1;

// ---------------------------------------------------------------------------
// Contract
// ---------------------------------------------------------------------------

#[contract]
pub struct ProxyRouter;

#[contractimpl]
impl ProxyRouter {
    /// One-time setup. `timelock` is the only address that may later
    /// authorize `upgrade` or `migrate`.
    ///
    /// # Panics
    /// Panics if the proxy has already been initialized.
    pub fn initialize(e: Env, timelock: Address) {
        if e.storage()
            .instance()
            .has(&DataKey::Config(ConfigKey::Timelock))
        {
            panic!("already initialized");
        }
        e.storage()
            .instance()
            .set(&DataKey::Config(ConfigKey::Timelock), &timelock);
        e.storage()
            .instance()
            .set(&DataKey::Config(ConfigKey::SchemaVersion), &SCHEMA_VERSION);
        e.storage()
            .instance()
            .set(&DataKey::Config(ConfigKey::ImplVersion), &1u32);
        e.storage()
            .instance()
            .set(&DataKey::State, &ProxyState { counter: 0 });
    }

    /// Replace this contract's WASM. State keys are preserved by the runtime.
    ///
    /// Only the stored Timelock contract can authorize this call. After the
    /// WASM swap the Timelock invokes `migrate` so the new implementation can
    /// apply additive schema changes in the same transaction.
    ///
    /// # Authorization
    /// Requires the Timelock contract to authorize (`require_auth`).
    ///
    /// # Events
    /// Emits `upgraded` with the new WASM hash.
    pub fn upgrade(e: Env, new_wasm_hash: BytesN<32>) {
        Self::require_timelock(&e);

        // The host swap is the on-chain path. Unit tests skip it because
        // locally-built WASM often uses reference-types that soroban-env-host
        // 22 cannot load, and dummy hashes are rejected as missing. Auth,
        // versioning, events, and migrate are still exercised.
        #[cfg(not(test))]
        e.deployer()
            .update_current_contract_wasm(new_wasm_hash.clone());

        let ver: u32 = e
            .storage()
            .instance()
            .get(&DataKey::Config(ConfigKey::ImplVersion))
            .unwrap_or(1);
        e.storage()
            .instance()
            .set(&DataKey::Config(ConfigKey::ImplVersion), &(ver + 1));

        e.events()
            .publish((symbol_short!("upgraded"),), new_wasm_hash);
    }

    /// Apply additive storage migrations required by this WASM revision.
    ///
    /// This implementation is schema 1 (genesis). It is a no-op when already
    /// at schema 1 and panics on a future (unknown) schema — that would mean
    /// this WASM was deployed over a newer implementation (downgrade).
    ///
    /// # Authorization
    /// Requires the Timelock contract to authorize.
    ///
    /// # Events
    /// Emits `migrated` with `(from_schema, to_schema)` when work is done.
    pub fn migrate(e: Env) {
        Self::require_timelock(&e);

        let from: u32 = Self::schema_version(&e);
        if from == SCHEMA_VERSION {
            return;
        }
        if from > SCHEMA_VERSION {
            panic!("schema downgrade forbidden");
        }

        // Stepwise migrations would land here as `if from == N { ... }`
        // arms. Schema 1 is genesis, so there is nothing to copy forward.
        e.storage()
            .instance()
            .set(&DataKey::Config(ConfigKey::SchemaVersion), &SCHEMA_VERSION);

        e.events()
            .publish((symbol_short!("migrated"),), (from, SCHEMA_VERSION));
    }

    /// Overwrite the sample application counter. Existing key `DataKey::State`
    /// is reused so upgrades never relocate this value.
    pub fn set_counter(e: Env, counter: u32) {
        e.storage()
            .instance()
            .set(&DataKey::State, &ProxyState { counter });
    }

    pub fn get_counter(e: Env) -> u32 {
        let state: ProxyState = e
            .storage()
            .instance()
            .get(&DataKey::State)
            .unwrap_or(ProxyState { counter: 0 });
        state.counter
    }

    /// Address of the Timelock that is the sole authorized upgrader.
    pub fn get_timelock(e: Env) -> Address {
        e.storage()
            .instance()
            .get(&DataKey::Config(ConfigKey::Timelock))
            .expect("not initialized")
    }

    /// Alias for [`Self::get_timelock`]: the timelock *is* the upgrade admin.
    pub fn get_admin(e: Env) -> Address {
        Self::get_timelock(e)
    }

    /// Number of successful WASM replacements plus one (starts at 1).
    pub fn get_version(e: Env) -> u32 {
        e.storage()
            .instance()
            .get(&DataKey::Config(ConfigKey::ImplVersion))
            .unwrap_or(1)
    }

    /// Storage schema version of the currently running implementation.
    pub fn get_schema_version(e: Env) -> u32 {
        Self::schema_version(&e)
    }

    pub fn version(e: Env) -> String {
        String::from_str(&e, "2.0.0")
    }

    pub fn status(e: Env) -> String {
        String::from_str(&e, "alive")
    }

    fn require_timelock(e: &Env) {
        let timelock: Address = e
            .storage()
            .instance()
            .get(&DataKey::Config(ConfigKey::Timelock))
            .expect("not initialized");
        timelock.require_auth();
    }

    fn schema_version(e: &Env) -> u32 {
        e.storage()
            .instance()
            .get(&DataKey::Config(ConfigKey::SchemaVersion))
            .unwrap_or(0)
    }
}
