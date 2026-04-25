use crate::*;
use soroban_sdk::{Env, String, Vec};

/// Validate token name
pub fn validate_name(
    e: &Env,
    name: &String,
    rules: &ValidationRules,
    blocked_words: &Vec<String>,
) -> ValidationResult {
    let name_str = name.to_string();
    let name_len = name_str.len() as u32;

    // Check if empty
    if name_len == 0 {
        return ValidationResult {
            is_valid: false,
            error_code: ERROR_EMPTY_FIELD,
            error_message: String::from_str(e, "Name cannot be empty"),
        };
    }

    // Check minimum length
    if name_len < rules.min_name_length {
        return ValidationResult {
            is_valid: false,
            error_code: ERROR_NAME_TOO_SHORT,
            error_message: String::from_str(e, "Name too short"),
        };
    }

    // Check maximum length
    if name_len > rules.max_name_length {
        return ValidationResult {
            is_valid: false,
            error_code: ERROR_NAME_TOO_LONG,
            error_message: String::from_str(e, "Name too long"),
        };
    }

    // Check for blocked words
    if contains_blocked_word(&name_str, blocked_words) {
        return ValidationResult {
            is_valid: false,
            error_code: ERROR_BLOCKED_WORD,
            error_message: String::from_str(e, "Name contains blocked word"),
        };
    }

    // Check for invalid characters
    if !rules.allow_special_chars && contains_special_chars(&name_str) {
        return ValidationResult {
            is_valid: false,
            error_code: ERROR_INVALID_CHARACTERS,
            error_message: String::from_str(e, "Name contains invalid characters"),
        };
    }

    // Check if numeric only
    if is_numeric_only(&name_str) {
        return ValidationResult {
            is_valid: false,
            error_code: ERROR_NUMERIC_ONLY,
            error_message: String::from_str(e, "Name cannot be numeric only"),
        };
    }

    ValidationResult {
        is_valid: true,
        error_code: ERROR_NONE,
        error_message: String::from_str(e, "Valid"),
    }
}

/// Validate token symbol
pub fn validate_symbol(
    e: &Env,
    symbol: &String,
    rules: &ValidationRules,
    blocked_words: &Vec<String>,
) -> ValidationResult {
    let symbol_str = symbol.to_string();
    let symbol_len = symbol_str.len() as u32;

    // Check if empty
    if symbol_len == 0 {
        return ValidationResult {
            is_valid: false,
            error_code: ERROR_EMPTY_FIELD,
            error_message: String::from_str(e, "Symbol cannot be empty"),
        };
    }

    // Check minimum length
    if symbol_len < rules.min_symbol_length {
        return ValidationResult {
            is_valid: false,
            error_code: ERROR_SYMBOL_TOO_SHORT,
            error_message: String::from_str(e, "Symbol too short"),
        };
    }

    // Check maximum length
    if symbol_len > rules.max_symbol_length {
        return ValidationResult {
            is_valid: false,
            error_code: ERROR_SYMBOL_TOO_LONG,
            error_message: String::from_str(e, "Symbol too long"),
        };
    }

    // Check for blocked words
    if contains_blocked_word(&symbol_str, blocked_words) {
        return ValidationResult {
            is_valid: false,
            error_code: ERROR_BLOCKED_WORD,
            error_message: String::from_str(e, "Symbol contains blocked word"),
        };
    }

    // Check if uppercase required
    if rules.require_uppercase_symbol && !is_uppercase(&symbol_str) {
        return ValidationResult {
            is_valid: false,
            error_code: ERROR_SYMBOL_NOT_UPPERCASE,
            error_message: String::from_str(e, "Symbol must be uppercase"),
        };
    }

    // Check for special characters (symbols should be alphanumeric)
    if contains_special_chars(&symbol_str) {
        return ValidationResult {
            is_valid: false,
            error_code: ERROR_INVALID_CHARACTERS,
            error_message: String::from_str(e, "Symbol contains invalid characters"),
        };
    }

    // Check if numeric only
    if is_numeric_only(&symbol_str) {
        return ValidationResult {
            is_valid: false,
            error_code: ERROR_NUMERIC_ONLY,
            error_message: String::from_str(e, "Symbol cannot be numeric only"),
        };
    }

    ValidationResult {
        is_valid: true,
        error_code: ERROR_NONE,
        error_message: String::from_str(e, "Valid"),
    }
}

/// Validate token description
pub fn validate_description(
    e: &Env,
    description: &String,
    rules: &ValidationRules,
    blocked_words: &Vec<String>,
) -> ValidationResult {
    let desc_str = description.to_string();
    let desc_len = desc_str.len() as u32;

    // Description can be empty (optional)
    if desc_len == 0 {
        return ValidationResult {
            is_valid: true,
            error_code: ERROR_NONE,
            error_message: String::from_str(e, "Valid"),
        };
    }

    // Check maximum length
    if desc_len > rules.max_description_length {
        return ValidationResult {
            is_valid: false,
            error_code: ERROR_DESCRIPTION_TOO_LONG,
            error_message: String::from_str(e, "Description too long"),
        };
    }

    // Check for blocked words
    if contains_blocked_word(&desc_str, blocked_words) {
        return ValidationResult {
            is_valid: false,
            error_code: ERROR_BLOCKED_WORD,
            error_message: String::from_str(e, "Description contains blocked word"),
        };
    }

    ValidationResult {
        is_valid: true,
        error_code: ERROR_NONE,
        error_message: String::from_str(e, "Valid"),
    }
}

/// Check if string contains blocked words (case-insensitive)
fn contains_blocked_word(text: &str, blocked_words: &Vec<String>) -> bool {
    let text_lower = text.to_lowercase();

    for blocked in blocked_words.iter() {
        let blocked_lower = blocked.to_string().to_lowercase();
        if text_lower.contains(&blocked_lower) {
            return true;
        }
    }

    false
}

/// Check if string contains special characters (only allows alphanumeric and spaces)
fn contains_special_chars(text: &str) -> bool {
    for c in text.chars() {
        if !c.is_alphanumeric() && c != ' ' {
            return true;
        }
    }
    false
}

/// Check if string is all uppercase
fn is_uppercase(text: &str) -> bool {
    for c in text.chars() {
        if c.is_alphabetic() && !c.is_uppercase() {
            return false;
        }
    }
    true
}

/// Check if string is numeric only
fn is_numeric_only(text: &str) -> bool {
    if text.is_empty() {
        return false;
    }

    for c in text.chars() {
        if !c.is_numeric() && c != ' ' {
            return false;
        }
    }
    true
}
