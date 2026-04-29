use soroban_sdk::{symbol_short, Address, Env, String};

pub fn emit_rules_updated(e: &Env) {
    e.events().publish((symbol_short!("rules"),), ());
}

pub fn emit_word_blocked(e: &Env, word: &String) {
    e.events().publish((symbol_short!("blocked"),), word);
}

pub fn emit_word_unblocked(e: &Env, word: &String) {
    e.events()
        .publish((symbol_short!("unblock"),), word);
}

pub fn emit_token_whitelisted(e: &Env, token: &Address) {
    e.events()
        .publish((symbol_short!("whitelist"),), token);
}
