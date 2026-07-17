//! Checked arithmetic used by vault valuation and fuzz/property tests.

pub fn collateral_value(amount: i128, price: i128, scale: i128) -> Option<i128> {
    if amount < 0 || price < 0 || scale <= 0 {
        return None;
    }
    amount.checked_mul(price)?.checked_div(scale)
}

pub fn collateralization_ratio(
    collateral_value: i128,
    debt_value: i128,
    basis_points: i128,
) -> Option<i128> {
    if collateral_value < 0 || debt_value <= 0 || basis_points <= 0 {
        return None;
    }
    collateral_value
        .checked_mul(basis_points)?
        .checked_div(debt_value)
}

#[cfg(test)]
mod property_tests {
    use super::*;
    use proptest::prelude::*;

    proptest! {
        #[test]
        fn valuation_matches_checked_reference(amount in 0i128..=1_000_000_000_000_000, price in 0i128..=1_000_000_000_000, scale in 1i128..=1_000_000_000) {
            let expected = amount.checked_mul(price).and_then(|v| v.checked_div(scale));
            prop_assert_eq!(collateral_value(amount, price, scale), expected);
        }

        #[test]
        fn valuation_is_monotonic(smaller in 0i128..=1_000_000_000_000, delta in 0i128..=1_000_000_000_000, price in 1i128..=1_000_000_000, scale in 1i128..=100_000_000) {
            if let Some(larger) = smaller.checked_add(delta) {
                let low = collateral_value(smaller, price, scale).unwrap();
                let high = collateral_value(larger, price, scale).unwrap();
                prop_assert!(high >= low);
            }
        }

        #[test]
        fn ratio_matches_checked_reference(collateral in 0i128..=1_000_000_000_000_000, debt in 1i128..=1_000_000_000_000) {
            let expected = collateral.checked_mul(10_000).and_then(|v| v.checked_div(debt));
            prop_assert_eq!(collateralization_ratio(collateral, debt, 10_000), expected);
        }
    }
}
