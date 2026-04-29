#![cfg(test)]

use super::*;
use soroban_sdk::{testutils::Address as _, Address, Env, String};

#[test]
fn test_initialize() {
    let e = Env::default();
    let admin = Address::generate(&e);

    let contract_id = e.register(MetadataValidator, ());
    let client = MetadataValidatorClient::new(&e, &contract_id);

    client.initialize(&admin);

    let rules = client.get_rules();
    assert_eq!(rules.min_name_length, 3);
    assert_eq!(rules.max_name_length, 50);
}

#[test]
fn test_validate_name_valid() {
    let e = Env::default();
    e.mock_all_auths();

    let admin = Address::generate(&e);
    let contract_id = e.register(MetadataValidator, ());
    let client = MetadataValidatorClient::new(&e, &contract_id);

    client.initialize(&admin);

    let name = String::from_str(&e, "My Token");
    let result = client.validate_name(&name);

    assert!(result.is_valid);
    assert_eq!(result.error_code, ERROR_NONE);
}

#[test]
fn test_validate_name_too_short() {
    let e = Env::default();
    e.mock_all_auths();

    let admin = Address::generate(&e);
    let contract_id = e.register(MetadataValidator, ());
    let client = MetadataValidatorClient::new(&e, &contract_id);

    client.initialize(&admin);

    let name = String::from_str(&e, "AB");
    let result = client.validate_name(&name);

    assert!(!result.is_valid);
    assert_eq!(result.error_code, ERROR_NAME_TOO_SHORT);
}

#[test]
fn test_validate_name_too_long() {
    let e = Env::default();
    e.mock_all_auths();

    let admin = Address::generate(&e);
    let contract_id = e.register(MetadataValidator, ());
    let client = MetadataValidatorClient::new(&e, &contract_id);

    client.initialize(&admin);

    let name = String::from_str(
        &e,
        "This is a very long token name that exceeds the maximum allowed length",
    );
    let result = client.validate_name(&name);

    assert!(!result.is_valid);
    assert_eq!(result.error_code, ERROR_NAME_TOO_LONG);
}

#[test]
fn test_validate_symbol_valid() {
    let e = Env::default();
    e.mock_all_auths();

    let admin = Address::generate(&e);
    let contract_id = e.register(MetadataValidator, ());
    let client = MetadataValidatorClient::new(&e, &contract_id);

    client.initialize(&admin);

    let symbol = String::from_str(&e, "TKN");
    let result = client.validate_symbol(&symbol);

    assert!(result.is_valid);
    assert_eq!(result.error_code, ERROR_NONE);
}

#[test]
fn test_validate_symbol_not_uppercase() {
    let e = Env::default();
    e.mock_all_auths();

    let admin = Address::generate(&e);
    let contract_id = e.register(MetadataValidator, ());
    let client = MetadataValidatorClient::new(&e, &contract_id);

    client.initialize(&admin);

    let symbol = String::from_str(&e, "tkn");
    let result = client.validate_symbol(&symbol);

    assert!(!result.is_valid);
    assert_eq!(result.error_code, ERROR_SYMBOL_NOT_UPPERCASE);
}

#[test]
fn test_validate_symbol_too_short() {
    let e = Env::default();
    e.mock_all_auths();

    let admin = Address::generate(&e);
    let contract_id = e.register(MetadataValidator, ());
    let client = MetadataValidatorClient::new(&e, &contract_id);

    client.initialize(&admin);

    let symbol = String::from_str(&e, "T");
    let result = client.validate_symbol(&symbol);

    assert!(!result.is_valid);
    assert_eq!(result.error_code, ERROR_SYMBOL_TOO_SHORT);
}

#[test]
fn test_validate_symbol_too_long() {
    let e = Env::default();
    e.mock_all_auths();

    let admin = Address::generate(&e);
    let contract_id = e.register(MetadataValidator, ());
    let client = MetadataValidatorClient::new(&e, &contract_id);

    client.initialize(&admin);

    let symbol = String::from_str(&e, "VERYLONGSYMBOL");
    let result = client.validate_symbol(&symbol);

    assert!(!result.is_valid);
    assert_eq!(result.error_code, ERROR_SYMBOL_TOO_LONG);
}

#[test]
fn test_validate_description_valid() {
    let e = Env::default();
    e.mock_all_auths();

    let admin = Address::generate(&e);
    let contract_id = e.register(MetadataValidator, ());
    let client = MetadataValidatorClient::new(&e, &contract_id);

    client.initialize(&admin);

    let description = String::from_str(&e, "This is a valid token description");
    let result = client.validate_description(&description);

    assert!(result.is_valid);
    assert_eq!(result.error_code, ERROR_NONE);
}

#[test]
fn test_validate_description_empty() {
    let e = Env::default();
    e.mock_all_auths();

    let admin = Address::generate(&e);
    let contract_id = e.register(MetadataValidator, ());
    let client = MetadataValidatorClient::new(&e, &contract_id);

    client.initialize(&admin);

    let description = String::from_str(&e, "");
    let result = client.validate_description(&description);

    // Empty description is valid (optional field)
    assert!(result.is_valid);
}

#[test]
fn test_blocked_word() {
    let e = Env::default();
    e.mock_all_auths();

    let admin = Address::generate(&e);
    let contract_id = e.register(MetadataValidator, ());
    let client = MetadataValidatorClient::new(&e, &contract_id);

    client.initialize(&admin);

    // Add blocked word
    let blocked = String::from_str(&e, "scam");
    client.add_blocked_word(&blocked);

    // Test name with blocked word
    let name = String::from_str(&e, "Scam Token");
    let result = client.validate_name(&name);

    assert!(!result.is_valid);
    assert_eq!(result.error_code, ERROR_BLOCKED_WORD);
}

#[test]
fn test_remove_blocked_word() {
    let e = Env::default();
    e.mock_all_auths();

    let admin = Address::generate(&e);
    let contract_id = e.register(MetadataValidator, ());
    let client = MetadataValidatorClient::new(&e, &contract_id);

    client.initialize(&admin);

    // Add and remove blocked word
    let blocked = String::from_str(&e, "test");
    client.add_blocked_word(&blocked);
    client.remove_blocked_word(&blocked);

    let blocked_words = client.get_blocked_words();
    assert_eq!(blocked_words.len(), 0);
}

#[test]
fn test_validate_all() {
    let e = Env::default();
    e.mock_all_auths();

    let admin = Address::generate(&e);
    let contract_id = e.register(MetadataValidator, ());
    let client = MetadataValidatorClient::new(&e, &contract_id);

    client.initialize(&admin);

    let name = String::from_str(&e, "My Token");
    let symbol = String::from_str(&e, "TKN");
    let description = String::from_str(&e, "A valid token");

    let (name_result, symbol_result, desc_result) =
        client.validate_all(&name, &symbol, &description);

    assert!(name_result.is_valid);
    assert!(symbol_result.is_valid);
    assert!(desc_result.is_valid);
}

#[test]
fn test_is_valid_metadata() {
    let e = Env::default();
    e.mock_all_auths();

    let admin = Address::generate(&e);
    let contract_id = e.register(MetadataValidator, ());
    let client = MetadataValidatorClient::new(&e, &contract_id);

    client.initialize(&admin);

    let name = String::from_str(&e, "My Token");
    let symbol = String::from_str(&e, "TKN");
    let description = String::from_str(&e, "A valid token");

    assert!(client.is_valid_metadata(&name, &symbol, &description));

    // Test with invalid symbol
    let invalid_symbol = String::from_str(&e, "t");
    assert!(!client.is_valid_metadata(&name, &invalid_symbol, &description));
}

#[test]
fn test_update_rules() {
    let e = Env::default();
    e.mock_all_auths();

    let admin = Address::generate(&e);
    let contract_id = e.register(MetadataValidator, ());
    let client = MetadataValidatorClient::new(&e, &contract_id);

    client.initialize(&admin);

    let new_rules = ValidationRules {
        min_name_length: 5,
        max_name_length: 100,
        min_symbol_length: 3,
        max_symbol_length: 15,
        max_description_length: 1000,
        allow_special_chars: true,
        require_uppercase_symbol: false,
    };

    client.update_rules(&new_rules);

    let rules = client.get_rules();
    assert_eq!(rules.min_name_length, 5);
    assert_eq!(rules.max_name_length, 100);
    assert!(rules.allow_special_chars);
}

#[test]
fn test_whitelist_token() {
    let e = Env::default();
    e.mock_all_auths();

    let admin = Address::generate(&e);
    let token = Address::generate(&e);

    let contract_id = e.register(MetadataValidator, ());
    let client = MetadataValidatorClient::new(&e, &contract_id);

    client.initialize(&admin);

    assert!(!client.is_whitelisted(&token));

    client.whitelist_token(&token);

    assert!(client.is_whitelisted(&token));
}

#[test]
fn test_special_characters() {
    let e = Env::default();
    e.mock_all_auths();

    let admin = Address::generate(&e);
    let contract_id = e.register(MetadataValidator, ());
    let client = MetadataValidatorClient::new(&e, &contract_id);

    client.initialize(&admin);

    // Test with special characters (should fail by default)
    let name = String::from_str(&e, "Token@123");
    let result = client.validate_name(&name);

    assert!(!result.is_valid);
    assert_eq!(result.error_code, ERROR_INVALID_CHARACTERS);

    // Update rules to allow special chars
    let new_rules = ValidationRules {
        min_name_length: 3,
        max_name_length: 50,
        min_symbol_length: 2,
        max_symbol_length: 10,
        max_description_length: 500,
        allow_special_chars: true,
        require_uppercase_symbol: true,
    };
    client.update_rules(&new_rules);

    // Should now be valid
    let result = client.validate_name(&name);
    assert!(result.is_valid);
}

#[test]
fn test_numeric_only() {
    let e = Env::default();
    e.mock_all_auths();

    let admin = Address::generate(&e);
    let contract_id = e.register(MetadataValidator, ());
    let client = MetadataValidatorClient::new(&e, &contract_id);

    client.initialize(&admin);

    let name = String::from_str(&e, "12345");
    let result = client.validate_name(&name);

    assert!(!result.is_valid);
    assert_eq!(result.error_code, ERROR_NUMERIC_ONLY);
}

#[test]
fn test_symbol_with_special_chars() {
    let e = Env::default();
    e.mock_all_auths();

    let admin = Address::generate(&e);
    let contract_id = e.register(MetadataValidator, ());
    let client = MetadataValidatorClient::new(&e, &contract_id);

    client.initialize(&admin);

    // Symbols should never allow special characters
    let symbol = String::from_str(&e, "TK@N");
    let result = client.validate_symbol(&symbol);

    assert!(!result.is_valid);
    assert_eq!(result.error_code, ERROR_INVALID_CHARACTERS);
}
