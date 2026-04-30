#\!/bin/bash
set -e

echo "=== Creating PR #1: Issue #445 - Pause Mechanism ==="
git checkout -b pr/445-pause main

# Add admin validation to lifecycle
cat > contracts/lifecycle/src/lifecycle.rs << 'EOF'
#\![no_std]

use soroban_sdk::{contracttype, symbol_short, Address, Env, Symbol};

#[cfg(test)]
mod test_lifecycle;

#[contracttype]
#[derive(Clone)]
enum DataKey {
    IsPaused,
    Admin,
}

const SYS_PAUSE: Symbol = symbol_short\!("sys_pause");
const SYS_UNPAUSE: Symbol = symbol_short\!("sys_unp");

pub fn initialize(e: &Env, admin: Address) {
    e.storage().persistent().set(&DataKey::Admin, &admin);
}

pub fn get_admin(e: &Env) -> Option<Address> {
    e.storage().persistent().get(&DataKey::Admin)
}

pub fn pause(e: Env, admin: Address) {
    let stored_admin: Address = e.storage().persistent()
        .get(&DataKey::Admin)
        .unwrap_or_else(|| panic\!("not initialized"));
    
    if admin \!= stored_admin {
        panic\!("only admin can pause");
    }
    
    admin.require_auth();
    e.storage().persistent().set(&DataKey::IsPaused, &true);
    e.events().publish((SYS_PAUSE,), admin);
}

pub fn unpause(e: Env, admin: Address) {
    let stored_admin: Address = e.storage().persistent()
        .get(&DataKey::Admin)
        .unwrap_or_else(|| panic\!("not initialized"));
    
    if admin \!= stored_admin {
        panic\!("only admin can unpause");
    }
    
    admin.require_auth();
    e.storage().persistent().set(&DataKey::IsPaused, &false);
    e.events().publish((SYS_UNPAUSE,), admin);
}

pub fn is_paused(e: &Env) -> bool {
    e.storage().persistent().get(&DataKey::IsPaused).unwrap_or(false)
}

pub fn require_not_paused(e: &Env) {
    if is_paused(e) {
        panic\!("Contract is paused");
    }
}
EOF

git add -A && git commit -m "feat: implement global pause mechanism with admin validation (#445)"
git push origin pr/445-pause --force

PR1_URL=$(gh pr create --base main --head pr/445-pause --title "feat: implement global pause mechanism with admin validation (#445)" --body "## Issue #445: Global Pause Mechanism

✅ Operations are blocked when paused
✅ Only authorized address can toggle pause")

echo "PR #445 created: $PR1_URL"
echo "$PR1_URL" > /tmp/pr_445_url

