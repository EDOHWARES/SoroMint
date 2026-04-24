use soroban_sdk::{Address, Env, Map};
use crate::storage::{VaultPosition, CollateralConfig, DataKey};

/// Calculate liquidation bonus for liquidator
pub fn calculate_liquidation_bonus(
    collateral_value: i128,
    debt_value: i128,
    penalty_bps: u32,
) -> i128 {
    let bonus = (debt_value * penalty_bps as i128) / 10000;
    bonus
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

    let ratio = (collateral_value * 10000) / debt_value;
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
        total += (amount * price) / 1_0000000;
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
    let value_with_penalty = debt_value + (debt_value * penalty_bps as i128) / 10000;
    
    // Convert to collateral amount
    let collateral_needed = (value_with_penalty * 1_0000000) / collateral_price;
    
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
        let token_value = (amount * price) / 1_0000000;
        
        // Calculate proportion
        let proportion = (token_value * 10000) / total_value;
        let debt_share = (debt_to_cover * proportion) / 10000;
        
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
