//! # Token Metadata Validator Contract
//!
//! Validates token names, symbols, and descriptions against platform safety guidelines
//! using regex patterns and configurable rules.

#![no_std]

mod events;
mod validation;

#[cfg(test)]
mod test;

use soroban_sdk::{contract, contractimpl, contracttype, Address, Env, String, Vec};
use validation::{validate_description, validate_name, validate_symbol};

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ValidationResult {
    pub is_valid: bool,
    pub error_code: u32,
    pub error_message: String,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ValidationRules {
    pub min_name_length: u32,
    pub max_name_length: u32,
    pub min_symbol_length: u32,
    pub max_symbol_length: u32,
    pub max_description_length: u32,
    pub allow_special_chars: bool,
    pub require_uppercase_symbol: bool,
}

#[contracttype]
pub enum ConfigKey {
    Admin,
    Rules,
}

#[contracttype]
pub enum DataKey {
    Config(ConfigKey),
    BlockedWords,
    BlockedPatterns,
    WhitelistedTokens,
}

// Error codes
pub const ERROR_NONE: u32 = 0;
pub const ERROR_NAME_TOO_SHORT: u32 = 1;
pub const ERROR_NAME_TOO_LONG: u32 = 2;
pub const ERROR_SYMBOL_TOO_SHORT: u32 = 3;
pub const ERROR_SYMBOL_TOO_LONG: u32 = 4;
pub const ERROR_DESCRIPTION_TOO_LONG: u32 = 5;
pub const ERROR_INVALID_CHARACTERS: u32 = 6;
pub const ERROR_BLOCKED_WORD: u32 = 7;
pub const ERROR_SYMBOL_NOT_UPPERCASE: u32 = 8;
pub const ERROR_EMPTY_FIELD: u32 = 9;
pub const ERROR_NUMERIC_ONLY: u32 = 10;

#[contract]
pub struct MetadataValidator;

#[contractimpl]
impl MetadataValidator {
    /// Initialize the validator with default rules
    pub fn initialize(e: Env, admin: Address) {
        if e.storage().instance().has(&DataKey::Config(ConfigKey::Admin)) {
            panic!("already initialized");
        }

        e.storage().instance().set(&DataKey::Config(ConfigKey::Admin), &admin);

        // Set default validation rules
        let default_rules = ValidationRules {
            min_name_length: 3,
            max_name_length: 50,
            min_symbol_length: 2,
            max_symbol_length: 10,
            max_description_length: 500,
            allow_special_chars: false,
            require_uppercase_symbol: true,
        };

        e.storage().instance().set(&DataKey::Config(ConfigKey::Rules), &default_rules);

        // Initialize empty blocked words list
        let blocked_words: Vec<String> = Vec::new(&e);
        e.storage()
            .persistent()
            .set(&DataKey::BlockedWords, &blocked_words);
    }

    /// Update validation rules (admin only)
    pub fn update_rules(e: Env, rules: ValidationRules) {
        let admin: Address = e.storage().instance().get(&DataKey::Config(ConfigKey::Admin)).unwrap();
        admin.require_auth();

        e.storage().instance().set(&DataKey::Config(ConfigKey::Rules), &rules);
        events::emit_rules_updated(&e);
    }

    /// Add a blocked word (admin only)
    pub fn add_blocked_word(e: Env, word: String) {
        let admin: Address = e.storage().instance().get(&DataKey::Config(ConfigKey::Admin)).unwrap();
        admin.require_auth();

        let mut blocked_words: Vec<String> = e
            .storage()
            .persistent()
            .get(&DataKey::BlockedWords)
            .unwrap_or(Vec::new(&e));

        blocked_words.push_back(word.clone());
        e.storage()
            .persistent()
            .set(&DataKey::BlockedWords, &blocked_words);

        events::emit_word_blocked(&e, &word);
    }

    /// Remove a blocked word (admin only)
    pub fn remove_blocked_word(e: Env, word: String) {
        let admin: Address = e.storage().instance().get(&DataKey::Config(ConfigKey::Admin)).unwrap();
        admin.require_auth();

        let blocked_words: Vec<String> = e
            .storage()
            .persistent()
            .get(&DataKey::BlockedWords)
            .unwrap_or(Vec::new(&e));

        let mut new_words = Vec::new(&e);
        for existing in blocked_words.iter() {
            if existing != word {
                new_words.push_back(existing);
            }
        }

        e.storage()
            .persistent()
            .set(&DataKey::BlockedWords, &new_words);

        events::emit_word_unblocked(&e, &word);
    }

    /// Validate token name
    pub fn validate_name(e: Env, name: String) -> ValidationResult {
        let rules: ValidationRules = e.storage().instance().get(&DataKey::Config(ConfigKey::Rules)).unwrap();
        let blocked_words: Vec<String> = e
            .storage()
            .persistent()
            .get(&DataKey::BlockedWords)
            .unwrap_or(Vec::new(&e));

        validate_name(&e, &name, &rules, &blocked_words)
    }

    /// Validate token symbol
    pub fn validate_symbol(e: Env, symbol: String) -> ValidationResult {
        let rules: ValidationRules = e.storage().instance().get(&DataKey::Config(ConfigKey::Rules)).unwrap();
        let blocked_words: Vec<String> = e
            .storage()
            .persistent()
            .get(&DataKey::BlockedWords)
            .unwrap_or(Vec::new(&e));

        validate_symbol(&e, &symbol, &rules, &blocked_words)
    }

    /// Validate token description
    pub fn validate_description(e: Env, description: String) -> ValidationResult {
        let rules: ValidationRules = e.storage().instance().get(&DataKey::Config(ConfigKey::Rules)).unwrap();
        let blocked_words: Vec<String> = e
            .storage()
            .persistent()
            .get(&DataKey::BlockedWords)
            .unwrap_or(Vec::new(&e));

        validate_description(&e, &description, &rules, &blocked_words)
    }

    /// Validate all token metadata at once
    pub fn validate_all(
        e: Env,
        name: String,
        symbol: String,
        description: String,
    ) -> (ValidationResult, ValidationResult, ValidationResult) {
        let name_result = Self::validate_name(e.clone(), name);
        let symbol_result = Self::validate_symbol(e.clone(), symbol);
        let description_result = Self::validate_description(e.clone(), description);

        (name_result, symbol_result, description_result)
    }

    /// Check if all metadata is valid
    pub fn is_valid_metadata(e: Env, name: String, symbol: String, description: String) -> bool {
        let (name_result, symbol_result, description_result) =
            Self::validate_all(e, name, symbol, description);

        name_result.is_valid && symbol_result.is_valid && description_result.is_valid
    }

    /// Whitelist a token (bypass validation)
    pub fn whitelist_token(e: Env, token: Address) {
        let admin: Address = e.storage().instance().get(&DataKey::Config(ConfigKey::Admin)).unwrap();
        admin.require_auth();

        let mut whitelisted: Vec<Address> = e
            .storage()
            .persistent()
            .get(&DataKey::WhitelistedTokens)
            .unwrap_or(Vec::new(&e));

        whitelisted.push_back(token.clone());
        e.storage()
            .persistent()
            .set(&DataKey::WhitelistedTokens, &whitelisted);

        events::emit_token_whitelisted(&e, &token);
    }

    /// Check if a token is whitelisted
    pub fn is_whitelisted(e: Env, token: Address) -> bool {
        let whitelisted: Vec<Address> = e
            .storage()
            .persistent()
            .get(&DataKey::WhitelistedTokens)
            .unwrap_or(Vec::new(&e));

        for addr in whitelisted.iter() {
            if addr == token {
                return true;
            }
        }
        false
    }

    /// Get current validation rules
    pub fn get_rules(e: Env) -> ValidationRules {
        e.storage().instance().get(&DataKey::Config(ConfigKey::Rules)).unwrap()
    }

    /// Get blocked words list
    pub fn get_blocked_words(e: Env) -> Vec<String> {
        e.storage()
            .persistent()
            .get(&DataKey::BlockedWords)
            .unwrap_or(Vec::new(&e))
    }
}
