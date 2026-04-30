//! # AI-Based Metadata Validator Contract
//!
//! Advanced token metadata validation using regex patterns and AI-ready architecture.
//! Ensures token names, symbols, and descriptions comply with platform safety guidelines.
//!
//! Features:
//! - Regex-based pattern matching
//! - Configurable validation rules
//! - Blocked words and phrases
//! - AI validation score integration (off-chain AI, on-chain verification)
//! - Risk scoring system
//! - Whitelist/blacklist management

#![no_std]

mod events;
mod patterns;
mod validation;

#[cfg(test)]
mod test;

use soroban_sdk::{contract, contractimpl, contracttype, Address, BytesN, Env, String, Vec};

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ValidationResult {
    pub is_valid: bool,
    pub risk_score: u32,      // 0-100, higher = more risky
    pub error_codes: Vec<u32>,
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
    pub allow_special_chars_name: bool,
    pub allow_special_chars_symbol: bool,
    pub require_uppercase_symbol: bool,
    pub max_risk_score: u32,  // Maximum acceptable risk score
    pub enable_ai_validation: bool,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AIValidationScore {
    pub score: u32,           // 0-100, AI confidence that content is safe
    pub timestamp: u64,
    pub validator: Address,   // Off-chain AI service that signed this
    pub signature: BytesN<64>, // Signature of the score
}

#[contracttype]
pub enum ConfigKey {
    Admin,
    Rules,
    TrustedAIValidators,
}

#[contracttype]
pub enum DataKey {
    Config(ConfigKey),
    BlockedWords,
    BlockedPatterns,
    WhitelistedTokens,
    BlacklistedAddresses,
    ValidationCache(BytesN<32>),
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
pub const ERROR_SUSPICIOUS_PATTERN: u32 = 11;
pub const ERROR_HIGH_RISK_SCORE: u32 = 12;
pub const ERROR_BLACKLISTED_ADDRESS: u32 = 13;
pub const ERROR_AI_VALIDATION_FAILED: u32 = 14;
pub const ERROR_REPEATED_CHARACTERS: u32 = 15;
pub const ERROR_MISLEADING_UNICODE: u32 = 16;

#[contract]
pub struct AIMetadataValidator;

#[contractimpl]
impl AIMetadataValidator {
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
            allow_special_chars_name: false,
            allow_special_chars_symbol: false,
            require_uppercase_symbol: true,
            max_risk_score: 30, // Allow up to 30% risk
            enable_ai_validation: false, // Disabled by default
        };

        e.storage().instance().set(&DataKey::Config(ConfigKey::Rules), &default_rules);

        // Initialize empty lists
        let blocked_words: Vec<String> = Vec::new(&e);
        e.storage()
            .persistent()
            .set(&DataKey::BlockedWords, &blocked_words);

        let trusted_validators: Vec<Address> = Vec::new(&e);
        e.storage()
            .instance()
            .set(&DataKey::Config(ConfigKey::TrustedAIValidators), &trusted_validators);

        events::emit_initialized(&e, &admin);
    }

    /// Update validation rules (admin only)
    pub fn update_rules(e: Env, rules: ValidationRules) {
        let admin: Address = e.storage().instance().get(&DataKey::Config(ConfigKey::Admin)).unwrap();
        admin.require_auth();

        e.storage().instance().set(&DataKey::Config(ConfigKey::Rules), &rules);
        events::emit_rules_updated(&e);
    }

    /// Add a blocked word or phrase (admin only)
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

    /// Add trusted AI validator (admin only)
    pub fn add_ai_validator(e: Env, validator: Address) {
        let admin: Address = e.storage().instance().get(&DataKey::Config(ConfigKey::Admin)).unwrap();
        admin.require_auth();

        let mut validators: Vec<Address> = e
            .storage()
            .instance()
            .get(&DataKey::Config(ConfigKey::TrustedAIValidators))
            .unwrap_or(Vec::new(&e));

        validators.push_back(validator.clone());
        e.storage()
            .instance()
            .set(&DataKey::Config(ConfigKey::TrustedAIValidators), &validators);

        events::emit_ai_validator_added(&e, &validator);
    }

    /// Blacklist an address (admin only)
    pub fn blacklist_address(e: Env, address: Address) {
        let admin: Address = e.storage().instance().get(&DataKey::Config(ConfigKey::Admin)).unwrap();
        admin.require_auth();

        let mut blacklist: Vec<Address> = e
            .storage()
            .persistent()
            .get(&DataKey::BlacklistedAddresses)
            .unwrap_or(Vec::new(&e));

        blacklist.push_back(address.clone());
        e.storage()
            .persistent()
            .set(&DataKey::BlacklistedAddresses, &blacklist);

        events::emit_address_blacklisted(&e, &address);
    }

    /// Check if address is blacklisted
    pub fn is_blacklisted(e: Env, address: Address) -> bool {
        let blacklist: Vec<Address> = e
            .storage()
            .persistent()
            .get(&DataKey::BlacklistedAddresses)
            .unwrap_or(Vec::new(&e));

        for addr in blacklist.iter() {
            if addr == address {
                return true;
            }
        }
        false
    }

    /// Validate token name with regex and pattern matching
    pub fn validate_name(e: Env, name: String) -> ValidationResult {
        let rules: ValidationRules = e.storage().instance().get(&DataKey::Config(ConfigKey::Rules)).unwrap();
        let blocked_words: Vec<String> = e
            .storage()
            .persistent()
            .get(&DataKey::BlockedWords)
            .unwrap_or(Vec::new(&e));

        validation::validate_name(&e, &name, &rules, &blocked_words)
    }

    /// Validate token symbol with regex and pattern matching
    pub fn validate_symbol(e: Env, symbol: String) -> ValidationResult {
        let rules: ValidationRules = e.storage().instance().get(&DataKey::Config(ConfigKey::Rules)).unwrap();
        let blocked_words: Vec<String> = e
            .storage()
            .persistent()
            .get(&DataKey::BlockedWords)
            .unwrap_or(Vec::new(&e));

        validation::validate_symbol(&e, &symbol, &rules, &blocked_words)
    }

    /// Validate token description with regex and pattern matching
    pub fn validate_description(e: Env, description: String) -> ValidationResult {
        let rules: ValidationRules = e.storage().instance().get(&DataKey::Config(ConfigKey::Rules)).unwrap();
        let blocked_words: Vec<String> = e
            .storage()
            .persistent()
            .get(&DataKey::BlockedWords)
            .unwrap_or(Vec::new(&e));

        validation::validate_description(&e, &description, &rules, &blocked_words)
    }

    /// Validate all metadata with optional AI validation
    pub fn validate_all(
        e: Env,
        creator: Address,
        name: String,
        symbol: String,
        description: String,
        ai_score: Option<AIValidationScore>,
    ) -> ValidationResult {
        // Check if creator is blacklisted
        if Self::is_blacklisted(e.clone(), creator.clone()) {
            let mut errors = Vec::new(&e);
            errors.push_back(ERROR_BLACKLISTED_ADDRESS);
            return ValidationResult {
                is_valid: false,
                risk_score: 100,
                error_codes: errors,
                error_message: String::from_str(&e, "Creator is blacklisted"),
            };
        }

        // Validate each field
        let name_result = Self::validate_name(e.clone(), name);
        let symbol_result = Self::validate_symbol(e.clone(), symbol);
        let desc_result = Self::validate_description(e.clone(), description);

        // Combine results
        let mut is_valid = name_result.is_valid && symbol_result.is_valid && desc_result.is_valid;
        let mut risk_score = (name_result.risk_score + symbol_result.risk_score + desc_result.risk_score) / 3;
        let mut all_errors = Vec::new(&e);

        // Collect all errors
        for err in name_result.error_codes.iter() {
            all_errors.push_back(err);
        }
        for err in symbol_result.error_codes.iter() {
            all_errors.push_back(err);
        }
        for err in desc_result.error_codes.iter() {
            all_errors.push_back(err);
        }

        // Check AI validation if provided and enabled
        let rules: ValidationRules = e.storage().instance().get(&DataKey::Config(ConfigKey::Rules)).unwrap();
        if rules.enable_ai_validation {
            if let Some(ai_validation) = ai_score {
                // Verify AI validator is trusted
                let validators: Vec<Address> = e
                    .storage()
                    .instance()
                    .get(&DataKey::Config(ConfigKey::TrustedAIValidators))
                    .unwrap_or(Vec::new(&e));

                let mut is_trusted = false;
                for validator in validators.iter() {
                    if validator == ai_validation.validator {
                        is_trusted = true;
                        break;
                    }
                }

                if is_trusted {
                    // Incorporate AI score (lower AI score = higher risk)
                    let ai_risk = 100 - ai_validation.score;
                    risk_score = (risk_score + ai_risk) / 2;
                } else {
                    all_errors.push_back(ERROR_AI_VALIDATION_FAILED);
                    is_valid = false;
                }
            } else {
                // AI validation required but not provided
                all_errors.push_back(ERROR_AI_VALIDATION_FAILED);
                is_valid = false;
            }
        }

        // Check if risk score exceeds threshold
        if risk_score > rules.max_risk_score {
            all_errors.push_back(ERROR_HIGH_RISK_SCORE);
            is_valid = false;
        }

        let message = if is_valid {
            String::from_str(&e, "Valid")
        } else {
            String::from_str(&e, "Validation failed")
        };

        ValidationResult {
            is_valid,
            risk_score,
            error_codes: all_errors,
            error_message: message,
        }
    }

    /// Quick boolean check for metadata validity
    pub fn is_valid_metadata(
        e: Env,
        creator: Address,
        name: String,
        symbol: String,
        description: String,
    ) -> bool {
        let result = Self::validate_all(e, creator, name, symbol, description, None);
        result.is_valid
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

    /// Get trusted AI validators
    pub fn get_ai_validators(e: Env) -> Vec<Address> {
        e.storage()
            .instance()
            .get(&DataKey::Config(ConfigKey::TrustedAIValidators))
            .unwrap_or(Vec::new(&e))
    }
}
