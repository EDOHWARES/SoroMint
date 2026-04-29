use soroban_sdk::{symbol_short, Address, BytesN, Env};

pub fn emit_initialized(e: &Env, admin: &Address, merkle_root: &BytesN<32>) {
    e.events()
        .publish((symbol_short!("init"),), (admin, merkle_root));
}

pub fn emit_root_updated(e: &Env, new_root: &BytesN<32>, version: u32) {
    e.events()
        .publish((symbol_short!("root_upd"), version), new_root);
}

pub fn emit_whitelist_claimed(e: &Env, address: &Address) {
    e.events().publish((symbol_short!("claimed"),), address);
}

pub fn emit_nonce_used(e: &Env, address: &Address, nonce: u64) {
    e.events()
        .publish((symbol_short!("nonce"),), (address, nonce));
}

pub fn emit_admin_transferred(e: &Env, old_admin: &Address, new_admin: &Address) {
    e.events()
        .publish((symbol_short!("admin"),), (old_admin, new_admin));
}
