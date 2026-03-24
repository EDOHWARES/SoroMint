/// # SoroMint Token Events Module
///
/// Provides helper functions for emitting structured Soroban events
/// for every state-changing operation in the SoroMint token contract.
///
/// ## Event Catalog
///
/// | Event                | Topics                                       | Data                                                      |
/// |----------------------|----------------------------------------------|-----------------------------------------------------------|
/// | `initialized`        | `("SoroMint", "init")`                       | `(admin, decimal, name, symbol)`                          |
/// | `mint`               | `("SoroMint", "mint")`                       | `(admin, to, amount, new_balance, new_supply)`            |
/// | `burn`               | `("SoroMint", "burn")`                       | `(admin, from, amount, new_balance, new_supply)`          |
/// | `ownership_transfer` | `("SoroMint", "xfer_own")`                   | `(prev_admin, new_admin)`                                 |
/// | `metadata_updated`   | `("SoroMint", "upd_meta")`                   | `(admin, old_name, old_symbol, new_name, new_symbol)`     |
///
/// Each function accepts the environment and the relevant parameters,
/// then publishes the event with the appropriate topic tuple and data payload.
use soroban_sdk::{symbol_short, Address, Env, String};

/// Emits an `initialized` event when the token contract is first set up.
///
/// # Arguments
/// * `env`     - The Soroban environment.
/// * `admin`   - The address designated as the contract administrator.
/// * `decimal` - The number of decimal places for the token.
/// * `name`    - The human-readable name of the token.
/// * `symbol`  - The ticker symbol for the token.
///
/// # Event Structure
/// - **Topics**: `("SoroMint", "init")`
/// - **Data**:   `(admin, decimal, name, symbol)`
pub fn emit_initialized(env: &Env, admin: &Address, decimal: u32, name: &String, symbol: &String) {
    let topics = (symbol_short!("SoroMint"), symbol_short!("init"));
    env.events().publish(
        topics,
        (admin.clone(), decimal, name.clone(), symbol.clone()),
    );
}

/// Emits a `mint` event when new tokens are minted to a recipient.
///
/// # Arguments
/// * `env`         - The Soroban environment.
/// * `admin`       - The admin address authorizing the mint.
/// * `to`          - The recipient address.
/// * `amount`      - The number of tokens minted.
/// * `new_balance` - The recipient's balance after the mint.
/// * `new_supply`  - The total token supply after the mint.
///
/// # Event Structure
/// - **Topics**: `("SoroMint", "mint")`
/// - **Data**:   `(admin, to, amount, new_balance, new_supply)`
pub fn emit_mint(
    env: &Env,
    admin: &Address,
    to: &Address,
    amount: i128,
    new_balance: i128,
    new_supply: i128,
) {
    let topics = (symbol_short!("SoroMint"), symbol_short!("mint"));
    env.events().publish(
        topics,
        (admin.clone(), to.clone(), amount, new_balance, new_supply),
    );
}

/// Emits a `burn` event when tokens are burned from a holder.
///
/// # Arguments
/// * `env`         - The Soroban environment.
/// * `admin`       - The admin address authorizing the burn.
/// * `from`        - The address whose tokens are burned.
/// * `amount`      - The number of tokens burned.
/// * `new_balance` - The holder's balance after the burn.
/// * `new_supply`  - The total token supply after the burn.
///
/// # Event Structure
/// - **Topics**: `("SoroMint", "burn")`
/// - **Data**:   `(admin, to, amount, new_balance, new_supply)`
pub fn emit_burn(
    env: &Env,
    admin: &Address,
    from: &Address,
    amount: i128,
    new_balance: i128,
    new_supply: i128,
) {
    let topics = (symbol_short!("SoroMint"), symbol_short!("burn"));
    env.events().publish(
        topics,
        (admin.clone(), from.clone(), amount, new_balance, new_supply),
    );
}

/// Emits an `ownership_transfer` event when the admin role is transferred.
///
/// # Arguments
/// * `env`        - The Soroban environment.
/// * `prev_admin` - The outgoing administrator address.
/// * `new_admin`  - The incoming administrator address.
///
/// # Event Structure
/// - **Topics**: `("SoroMint", "xfer_own")`
/// - **Data**:   `(prev_admin, new_admin)`
pub fn emit_ownership_transfer(env: &Env, prev_admin: &Address, new_admin: &Address) {
    let topics = (symbol_short!("SoroMint"), symbol_short!("xfer_own"));
    env.events()
        .publish(topics, (prev_admin.clone(), new_admin.clone()));
}

/// Emits a `metadata_updated` event when the token metadata is updated.
///
/// # Arguments
/// * `env`        - The Soroban environment.
/// * `admin`      - The administrator address authorizing the update.
/// * `old_name`   - The previously set token name.
/// * `old_symbol` - The previously set token symbol.
/// * `new_name`   - The new token name.
/// * `new_symbol` - The new token symbol.
///
/// # Event Structure
/// - **Topics**: `("SoroMint", "upd_meta")`
/// - **Data**:   `(admin, old_name, old_symbol, new_name, new_symbol)`
pub fn emit_metadata_updated(
    env: &Env,
    admin: &Address,
    old_name: &String,
    old_symbol: &String,
    new_name: &String,
    new_symbol: &String,
) {
    let topics = (symbol_short!("SoroMint"), symbol_short!("upd_meta"));
    env.events().publish(
        topics,
        (
            admin.clone(),
            old_name.clone(),
            old_symbol.clone(),
            new_name.clone(),
            new_symbol.clone(),
        ),
    );
}
