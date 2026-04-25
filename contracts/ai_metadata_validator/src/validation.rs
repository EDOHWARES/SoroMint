use crate::*;
use crate::patterns::*;
use soroban_sdk::{Env, String, Vec};

/// Validate token name with comprehensive checks
pub fn validate_name(
    e: &Env,
    name: &String,
    rules: &ValidationRules,
    blocked_words: &Vec<String>,
) -> ValidationResult {
    let name_str = name.to_string();
    let name_len = name_str.len() as u32;
    let mut errors = Vec::new(e);
    let mut risk_score = 0u32;

    // Check if empty
    if name_len == 0 {
        errors.push_back(ERROR_EMPTY_FIELD);
        return ValidationResult {
            is_valid: false,
            risk_score: 100,
            error_codes: errors,
            error_message: String::from_str(e, "Name cannot be empty"),
        };
    }

    // Check minimum length
    if name_len < rules.min_name_length {
        errors.push_back(ERROR_NAME_TOO_SHORT);
        risk_score += 20;
    }

    // Check maximum length
    if name_len > rules.max_name_length {
        errors.push_back(ERROR_NAME_TOO_LONG);
        risk_score += 15;
    }

    // Check for blocked words
    if contains_blocked_word(&name_str, blocked_words) {
        errors.push_back(ERROR_BLOCKED_WORD);
        risk_score += 50;
    }

    // Check for invalid characters
    if !rules.allow_special_chars_name && contains_special_chars(&name_str) {
        errors.push_back(ERROR_INVALID_CHARACTERS);
        risk_score += 25;
    }

    // Check if numeric only
    if is_numeric_only(&name_str) {
        errors.push_back(ERROR_NUMERIC_ONLY);
        risk_score += 30;
    }

    // Check for repeated characters (spam pattern)
    if has_repeated_characters(&name_str, 4) {
        errors.push_back(ERROR_REPEATED_CHARACTERS);
        risk_score += 20;
    }

    // Check for suspicious patterns
    if contains_suspicious_pattern(&name_str) {
        errors.push_back(ERROR_SUSPICIOUS_PATTERN);
        risk_score += 35;
    }

    // Check for misleading Unicode
    if contains_misleading_unicode(&name_str) {
        errors.push_back(ERROR_MISLEADING_UNICODE);
        risk_score += 40;
    }

    // Cap risk score at 100
    if risk_score > 100 {
        risk_score = 100;
    }

    let is_valid = errors.len() == 0;
    let message = if is_valid {
        String::from_str(e, "Valid")
    } else {
        String::from_str(e, "Name validation failed")
    };

    ValidationResult {
        is_valid,
        risk_score,
        error_codes: errors,
        error_message: message,
    }
}

/// Validate token symbol with comprehensive checks
pub fn validate_symbol(
    e: &Env,
    symbol: &String,
    rules: &ValidationRules,
    blocked_words: &Vec<String>,
) -> ValidationResult {
    let symbol_str = symbol.to_string();
    let symbol_len = symbol_str.len() as u32;
    let mut errors = Vec::new(e);
    let mut risk_score = 0u32;

    // Check if empty
    if symbol_len == 0 {
        errors.push_back(ERROR_EMPTY_FIELD);
        return ValidationResult {
            is_valid: false,
            risk_score: 100,
            error_codes: errors,
            error_message: String::from_str(e, "Symbol cannot be empty"),
        };
    }

    // Check minimum length
    if symbol_len < rules.min_symbol_length {
        errors.push_back(ERROR_SYMBOL_TOO_SHORT);
        risk_score += 20;
    }

    // Check maximum length
    if symbol_len > rules.max_symbol_length {
        errors.push_back(ERROR_SYMBOL_TOO_LONG);
        risk_score += 15;
    }

    // Check for blocked words
    if contains_blocked_word(&symbol_str, blocked_words) {
        errors.push_back(ERROR_BLOCKED_WORD);
        risk_score += 50;
    }

    // Check if uppercase required
    if rules.require_uppercase_symbol && !is_uppercase(&symbol_str) {
        errors.push_back(ERROR_SYMBOL_NOT_UPPERCASE);
        risk_score += 10;
    }

    // Symbols should never allow special characters (security best practice)
    if contains_special_chars(&symbol_str) {
        errors.push_back(ERROR_INVALID_CHARACTERS);
        risk_score += 30;
    }

    // Check if numeric only
    if is_numeric_only(&symbol_str) {
        errors.push_back(ERROR_NUMERIC_ONLY);
        risk_score += 35;
    }

    // Check for repeated characters
    if has_repeated_characters(&symbol_str, 3) {
        errors.push_back(ERROR_REPEATED_CHARACTERS);
        risk_score += 25;
    }

    // Check for misleading Unicode
    if contains_misleading_unicode(&symbol_str) {
        errors.push_back(ERROR_MISLEADING_UNICODE);
        risk_score += 45;
    }

    // Cap risk score at 100
    if risk_score > 100 {
        risk_score = 100;
    }

    let is_valid = errors.len() == 0;
    let message = if is_valid {
        String::from_str(e, "Valid")
    } else {
        String::from_str(e, "Symbol validation failed")
    };

    ValidationResult {
        is_valid,
        risk_score,
        error_codes: errors,
        error_message: message,
    }
}

/// Validate token description with comprehensive checks
pub fn validate_description(
    e: &Env,
    description: &String,
    rules: &ValidationRules,
    blocked_words: &Vec<String>,
) -> ValidationResult {
    let desc_str = description.to_string();
    let desc_len = desc_str.len() as u32;
    let mut errors = Vec::new(e);
    let mut risk_score = 0u32;

    // Description can be empty (optional)
    if desc_len == 0 {
        return ValidationResult {
            is_valid: true,
            risk_score: 0,
            error_codes: errors,
            error_message: String::from_str(e, "Valid"),
        };
    }

    // Check maximum length
    if desc_len > rules.max_description_length {
        errors.push_back(ERROR_DESCRIPTION_TOO_LONG);
        risk_score += 15;
    }

    // Check for blocked words
    if contains_blocked_word(&desc_str, blocked_words) {
        errors.push_back(ERROR_BLOCKED_WORD);
        risk_score += 40;
    }

    // Check for suspicious patterns
    if contains_suspicious_pattern(&desc_str) {
        errors.push_back(ERROR_SUSPICIOUS_PATTERN);
        risk_score += 30;
    }

    // Check for excessive repeated characters
    if has_repeated_characters(&desc_str, 5) {
        errors.push_back(ERROR_REPEATED_CHARACTERS);
        risk_score += 15;
    }

    // Check for misleading Unicode
    if contains_misleading_unicode(&desc_str) {
        errors.push_back(ERROR_MISLEADING_UNICODE);
        risk_score += 35;
    }

    // Check for spam patterns (excessive URLs, etc.)
    if contains_spam_pattern(&desc_str) {
        errors.push_back(ERROR_SUSPICIOUS_PATTERN);
        risk_score += 25;
    }

    // Cap risk score at 100
    if risk_score > 100 {
        risk_score = 100;
    }

    let is_valid = errors.len() == 0;
    let message = if is_valid {
        String::from_str(e, "Valid")
    } else {
        String::from_str(e, "Description validation failed")
    };

    ValidationResult {
        is_valid,
        risk_score,
        error_codes: errors,
        error_message: message,
    }
}
