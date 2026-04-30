use soroban_sdk::{Address, Env, Map};
use crate::storage::{VaultPosition, CollateralConfig, DataKey};

/// Calculate liquidation bonus for liquidator
pub fn calculate_liquidation_bonus(
    collateral_value: i128,
    debt_value: i128,
    penalty_bps: u32,
) -> i128 {
    debt_value
        .checked_mul(penalty_bps as i128)
        .expect("liquidation bonus multiplication overflow")
        .checked_div(10000)
        .expect("liquidation bonus division failed")
}

/// Determine if a vault should be liquidated
pub fn should_liquidate(
    e: &Env,
    position: &VaultPosition,
    liquidation_threshold: u32,
) -> bool {
    if position.debt == 0 {
        return false;
    }

    let collateral_value = calculate_total_collateral_value(e, &position.collaterals);
    let debt_value = position.debt; // Assuming 1:1 with USD

    let ratio = collateral_value
        .checked_mul(10000)
        .expect("liquidation ratio multiplication overflow")
        .checked_div(debt_value)
        .expect("liquidation ratio division failed");
    ratio < liquidation_threshold as i128
}

/// Calculate total collateral value across all tokens
pub fn calculate_total_collateral_value(
    e: &Env,
    collaterals: &Map<Address, i128>,
) -> i128 {
    let oracle: Address = e.storage().instance().get(&DataKey::Oracle).unwrap();
    let mut total = 0i128;

    for (token, amount) in collaterals.iter() {
        let price = crate::oracle::get_price(e, &oracle, &token);
        let value = amount
            .checked_mul(price)
            .expect("collateral value multiplication overflow")
            .checked_div(1_0000000)
            .expect("collateral value division failed");
        total = total
            .checked_add(value)
            .expect("total collateral addition overflow");
    }

    total
}

/// Calculate how much collateral to seize for a given debt amount
pub fn calculate_collateral_to_seize(
    collateral_amount: i128,
    collateral_price: i128,
    debt_to_cover: i128,
    penalty_bps: u32,
) -> i128 {
    // Value of debt to cover
    let debt_value = debt_to_cover;
    
    // Add liquidation penalty
    let value_with_penalty = debt_value
        .checked_add(
            debt_value
                .checked_mul(penalty_bps as i128)
                .expect("liquidation penalty multiplication overflow")
                .checked_div(10000)
                .expect("liquidation penalty division failed"),
        )
        .expect("liquidation penalty addition overflow");
    
    // Convert to collateral amount
    let collateral_needed = value_with_penalty
        .checked_mul(1_0000000)
        .expect("collateral needed multiplication overflow")
        .checked_div(collateral_price)
        .expect("collateral needed division failed");
    
    // Cap at available collateral
    if collateral_needed > collateral_amount {
        collateral_amount
    } else {
        collateral_needed
    }
}

/// Distribute seized collateral proportionally
pub fn distribute_seized_collateral(
    e: &Env,
    collaterals: &Map<Address, i128>,
    debt_to_cover: i128,
) -> Map<Address, i128> {
    let mut seized = Map::new(e);
    let total_value = calculate_total_collateral_value(e, collaterals);
    let oracle: Address = e.storage().instance().get(&DataKey::Oracle).unwrap();

    for (token, amount) in collaterals.iter() {
        let price = crate::oracle::get_price(e, &oracle, &token);
        let token_value = amount
            .checked_mul(price)
            .expect("token value multiplication overflow")
            .checked_div(1_0000000)
            .expect("token value division failed");
        
        // Calculate proportion
        let proportion = token_value
            .checked_mul(10000)
            .expect("proportion multiplication overflow")
            .checked_div(total_value)
            .expect("proportion division failed");
        let debt_share = debt_to_cover
            .checked_mul(proportion)
            .expect("debt share multiplication overflow")
            .checked_div(10000)
            .expect("debt share division failed");
        
        // Get liquidation config
        let config: CollateralConfig = e.storage().persistent()
            .get(&DataKey::CollateralConfig(token.clone()))
            .unwrap();
        
        // Calculate amount to seize with penalty
        let amount_to_seize = calculate_collateral_to_seize(
            amount,
            price,
            debt_share,
            config.liquidation_penalty,
        );
        
        seized.set(token, amount_to_seize);
    }

    seized
}
