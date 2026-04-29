use soroban_sdk::{symbol_short, Address, Env, String};

pub fn emit_initialized(e: &Env, admin: &Address) {
    e.events().publish((symbol_short!("init"),), admin);
}

pub fn emit_rules_updated(e: &Env) {
    e.events().publish((symbol_short!("rules"),), ());
}

pub fn emit_word_blocked(e: &Env, word: &String) {
    e.events().publish((symbol_short!("blocked"),), word);
}

pub fn emit_word_unblocked(e: &Env, word: &String) {
    e.events().publish((symbol_short!("unblock"),), word);
}

pub fn emit_token_whitelisted(e: &Env, token: &Address) {
    e.events().publish((symbol_short!("whitelist"),), token);
}

pub fn emit_address_blacklisted(e: &Env, address: &Address) {
    e.events().publish((symbol_short!("blacklist"),), address);
}

pub fn emit_ai_validator_added(e: &Env, validator: &Address) {
    e.events().publish((symbol_short!("ai_add"),), validator);
}
