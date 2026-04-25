#![cfg(test)]

use super::*;
use soroban_sdk::{testutils::Address as _, Address, Env, String};

#[test]
fn test_initialize() {
    let e = Env::default();
    let admin = Address::generate(&e);

    let contract_id = e.register(AIMetadataValidator, ());
    let client = AIMetadataValidatorClient::new(&e, &contract_id);

    client.initialize(&admin);

    let rules = client.get_rules();
    assert_eq!(rules.min_name_length, 3);
    assert_eq!(rules.max_name_length, 50);
    assert_eq!(rules.max_risk_score, 30);
}

#[test]
fn test_validate_name_valid() {
    let e = Env::default();
    e.mock_all_auths();

    let admin = Address::generate(&e);
    let contract_id = e.register(AIMetadataValidator, ());
    let client = AIMetadataValidatorClient::new(&e, &contract_id);

    client.initialize(&admin);

    let name = String::from_str(&e, "My Token");
    let result = client.validate_name(&name);

    assert!(result.is_valid);
    assert_eq!(result.error_codes.len(), 0);
}

#[test]
fn test_validate_name_too_short() {
    let e = Env::default();
    e.mock_all_auths();

    let admin = Address::generate(&e);
    let contract_id = e.register(AIMetadataValidator, ());
    let client = AIMetadataValidatorClient::new(&e, &contract_id);

    client.initialize(&admin);

    let name = String::from_str(&e, "AB");
    let result = client.validate_name(&name);

    assert!(!result.is_valid);
    assert!(result.error_codes.first().unwrap() == ERROR_NAME_TOO_SHORT);
}

#[test]
fn test_validate_symbol_valid() {
    let e = Env::default();
    e.mock_all_auths();

    let admin = Address::generate(&e);
    let contract_id = e.register(AIMetadataValidator, ());
    let client = AIMetadataValidatorClient::new(&e, &contract_id);

    client.initialize(&admin);

    let symbol = String::from_str(&e, "TKN");
    let result = client.validate_symbol(&symbol);

    assert!(result.is_valid);
    assert_eq!(result.error_codes.len(), 0);
}

#[test]
fn test_validate_symbol_not_uppercase() {
    let e = Env::default();
    e.mock_all_auths();

    let admin = Address::generate(&e);
    let contract_id = e.register(AIMetadataValidator, ());
    let client = AIMetadataValidatorClient::new(&e, &contract_id);

    client.initialize(&admin);

    let symbol = String::from_str(&e, "tkn");
    let result = client.validate_symbol(&symbol);

    assert!(!result.is_valid);
    assert!(result.error_codes.first().unwrap() == ERROR_SYMBOL_NOT_UPPERCASE);
}

#[test]
fn test_blocked_word() {
    let e = Env::default();
    e.mock_all_auths();

    let admin = Address::generate(&e);
    let contract_id = e.register(AIMetadataValidator, ());
    let client = AIMetadataValidatorClient::new(&e, &contract_id);

    client.initialize(&admin);

    // Add blocked word
    let blocked = String::from_str(&e, "scam");
    client.add_blocked_word(&blocked);

    // Test name with blocked word
    let name = String::from_str(&e, "Scam Token");
    let result = client.validate_name(&name);

    assert!(!result.is_valid);
    assert!(result.risk_score >= 50);
}

#[test]
fn test_validate_all() {
    let e = Env::default();
    e.mock_all_auths();

    let admin = Address::generate(&e);
    let creator = Address::generate(&e);
    let contract_id = e.register(AIMetadataValidator, ());
    let client = AIMetadataValidatorClient::new(&e, &contract_id);

    client.initialize(&admin);

    let name = String::from_str(&e, "My Token");
    let symbol = String::from_str(&e, "TKN");
    let description = String::from_str(&e, "A valid token");

    let result = client.validate_all(&creator, &name, &symbol, &description, &None);

    assert!(result.is_valid);
    assert!(result.risk_score < 30);
}

#[test]
fn test_blacklisted_address() {
    let e = Env::default();
    e.mock_all_auths();

    let admin = Address::generate(&e);
    let bad_actor = Address::generate(&e);
    let contract_id = e.register(AIMetadataValidator, ());
    let client = AIMetadataValidatorClient::new(&e, &contract_id);

    client.initialize(&admin);

    // Blacklist address
    client.blacklist_address(&bad_actor);

    assert!(client.is_blacklisted(&bad_actor));

    // Try to validate with blacklisted address
    let name = String::from_str(&e, "Good Token");
    let symbol = String::from_str(&e, "GOOD");
    let description = String::from_str(&e, "Legitimate");

    let result = client.validate_all(&bad_actor, &name, &symbol, &description, &None);

    assert!(!result.is_valid);
    assert_eq!(result.risk_score, 100);
}

#[test]
fn test_whitelist_token() {
    let e = Env::default();
    e.mock_all_auths();

    let admin = Address::generate(&e);
    let token = Address::generate(&e);
    let contract_id = e.register(AIMetadataValidator, ());
    let client = AIMetadataValidatorClient::new(&e, &contract_id);

    client.initialize(&admin);

    assert!(!client.is_whitelisted(&token));

    client.whitelist_token(&token);

    assert!(client.is_whitelisted(&token));
}

#[test]
fn test_risk_score_calculation() {
    let e = Env::default();
    e.mock_all_auths();

    let admin = Address::generate(&e);
    let creator = Address::generate(&e);
    let contract_id = e.register(AIMetadataValidator, ());
    let client = AIMetadataValidatorClient::new(&e, &contract_id);

    client.initialize(&admin);

    // Add some blocked words
    client.add_blocked_word(&String::from_str(&e, "scam"));
    client.add_blocked_word(&String::from_str(&e, "airdrop"));

    // Test with suspicious content
    let name = String::from_str(&e, "Free Airdrop Token");
    let symbol = String::from_str(&e, "SCAM");
    let description = String::from_str(&e, "Get rich quick guaranteed 100x");

    let result = client.validate_all(&creator, &name, &symbol, &description, &None);

    assert!(!result.is_valid);
    assert!(result.risk_score > 50);
}

#[test]
fn test_repeated_characters() {
    let e = Env::default();
    e.mock_all_auths();

    let admin = Address::generate(&e);
    let contract_id = e.register(AIMetadataValidator, ());
    let client = AIMetadataValidatorClient::new(&e, &contract_id);

    client.initialize(&admin);

    let name = String::from_str(&e, "AAAAAAA Token");
    let result = client.validate_name(&name);

    assert!(!result.is_valid);
    assert!(result.risk_score > 0);
}

#[test]
fn test_numeric_only() {
    let e = Env::default();
    e.mock_all_auths();

    let admin = Address::generate(&e);
    let contract_id = e.register(AIMetadataValidator, ());
    let client = AIMetadataValidatorClient::new(&e, &contract_id);

    client.initialize(&admin);

    let name = String::from_str(&e, "12345");
    let result = client.validate_name(&name);

    assert!(!result.is_valid);
}

#[test]
fn test_update_rules() {
    let e = Env::default();
    e.mock_all_auths();

    let admin = Address::generate(&e);
    let contract_id = e.register(AIMetadataValidator, ());
    let client = AIMetadataValidatorClient::new(&e, &contract_id);

    client.initialize(&admin);

    let new_rules = ValidationRules {
        min_name_length: 5,
        max_name_length: 100,
        min_symbol_length: 3,
        max_symbol_length: 15,
        max_description_length: 1000,
        allow_special_chars_name: true,
        allow_special_chars_symbol: false,
        require_uppercase_symbol: false,
        max_risk_score: 50,
        enable_ai_validation: false,
    };

    client.update_rules(&new_rules);

    let rules = client.get_rules();
    assert_eq!(rules.min_name_length, 5);
    assert_eq!(rules.max_risk_score, 50);
}

#[test]
fn test_add_ai_validator() {
    let e = Env::default();
    e.mock_all_auths();

    let admin = Address::generate(&e);
    let ai_validator = Address::generate(&e);
    let contract_id = e.register(AIMetadataValidator, ());
    let client = AIMetadataValidatorClient::new(&e, &contract_id);

    client.initialize(&admin);

    client.add_ai_validator(&ai_validator);

    let validators = client.get_ai_validators();
    assert_eq!(validators.len(), 1);
    assert_eq!(validators.get(0).unwrap(), ai_validator);
}

#[test]
fn test_is_valid_metadata_quick_check() {
    let e = Env::default();
    e.mock_all_auths();

    let admin = Address::generate(&e);
    let creator = Address::generate(&e);
    let contract_id = e.register(AIMetadataValidator, ());
    let client = AIMetadataValidatorClient::new(&e, &contract_id);

    client.initialize(&admin);

    let name = String::from_str(&e, "My Token");
    let symbol = String::from_str(&e, "TKN");
    let description = String::from_str(&e, "A valid token");

    assert!(client.is_valid_metadata(&creator, &name, &symbol, &description));

    // Test with invalid
    let bad_symbol = String::from_str(&e, "t");
    assert!(!client.is_valid_metadata(&creator, &name, &bad_symbol, &description));
}

#[test]
fn test_special_characters() {
    let e = Env::default();
    e.mock_all_auths();

    let admin = Address::generate(&e);
    let contract_id = e.register(AIMetadataValidator, ());
    let client = AIMetadataValidatorClient::new(&e, &contract_id);

    client.initialize(&admin);

    // Test with special characters (should fail by default)
    let name = String::from_str(&e, "Token@123");
    let result = client.validate_name(&name);

    assert!(!result.is_valid);
}

#[test]
fn test_empty_description_valid() {
    let e = Env::default();
    e.mock_all_auths();

    let admin = Address::generate(&e);
    let contract_id = e.register(AIMetadataValidator, ());
    let client = AIMetadataValidatorClient::new(&e, &contract_id);

    client.initialize(&admin);

    let description = String::from_str(&e, "");
    let result = client.validate_description(&description);

    // Empty description is valid (optional field)
    assert!(result.is_valid);
    assert_eq!(result.risk_score, 0);
}
