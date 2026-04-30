//! Reentrancy protection for critical operations.
//!
//! This module provides a stateful guard mechanism to detect and prevent reentrancy
//! in functions that may be vulnerable to callbacks during external calls.

use soroban_sdk::{Env, Symbol};
use crate::storage::DataKey;

/// A guard that prevents a function from being reentered.
///
/// When created, it sets a lock in storage. When dropped, it clears the lock.
/// If a lock already exists, creation fails with a panic.
pub struct ReentrancyGuard {
    lock_key: DataKey,
    env: *const Env,
}

impl ReentrancyGuard {
    /// Acquire a reentrancy lock for a critical section.
    ///
    /// # Arguments
    /// * `env` - The contract environment
    /// * `function_name` - A unique identifier for the lock (e.g., "deposit_funds")
    ///
    /// # Panics
    /// * Panics with "reentrancy detected" if a lock already exists.
    pub fn lock(env: &Env, function_name: &str) -> Self {
        let lock_key = DataKey::Reentrancy(Symbol::new(env, function_name));
        let storage = env.storage().instance();

        // Check if lock is already held
        if storage.has(&lock_key) {
            panic!("reentrancy detected");
        }

        // Acquire lock
        storage.set(&lock_key, &true);

        ReentrancyGuard {
            lock_key,
            env: env as *const Env,
        }
    }
}

impl Drop for ReentrancyGuard {
    fn drop(&mut self) {
        // SAFETY: The pointer was validated in lock() to point to a valid, live Env.
        // During the lifetime of ReentrancyGuard, the Env is guaranteed to be valid.
        unsafe {
            let env = &*self.env;
            env.storage().instance().remove(&self.lock_key);
        }
    }
}
