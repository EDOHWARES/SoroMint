//! Overflow-safe release schedule arithmetic.

pub fn vested_amount(
    total_amount: i128,
    start_ledger: u32,
    stop_ledger: u32,
    current_ledger: u32,
) -> Option<i128> {
    if total_amount < 0 || stop_ledger <= start_ledger {
        return None;
    }
    if current_ledger <= start_ledger {
        return Some(0);
    }
    if current_ledger >= stop_ledger {
        return Some(total_amount);
    }

    let elapsed = i128::from(current_ledger - start_ledger);
    let duration = i128::from(stop_ledger - start_ledger);
    total_amount.checked_mul(elapsed)?.checked_div(duration)
}

#[cfg(test)]
mod property_tests {
    use super::*;
    use proptest::prelude::*;

    proptest! {
        #[test]
        fn release_is_bounded_and_complete(total in 0i128..=1_000_000_000_000_000, start in 0u32..=1_000_000, duration in 1u32..=1_000_000) {
            let stop = start + duration;
            prop_assert_eq!(vested_amount(total, start, stop, start), Some(0));
            prop_assert_eq!(vested_amount(total, start, stop, stop), Some(total));
            let vested = vested_amount(total, start, stop, start + duration / 2).unwrap();
            prop_assert!((0..=total).contains(&vested));
        }

        #[test]
        fn release_is_monotonic(total in 0i128..=1_000_000_000_000_000, start in 0u32..=1_000_000, duration in 1u32..=1_000_000, first in 0u32..=1_000_000, second in 0u32..=1_000_000) {
            let stop = start + duration;
            let a = start + first.min(duration);
            let b = start + second.min(duration);
            let (earlier, later) = if a <= b { (a, b) } else { (b, a) };
            prop_assert!(vested_amount(total, start, stop, later).unwrap() >= vested_amount(total, start, stop, earlier).unwrap());
        }

        #[test]
        fn indivisible_totals_release_fully(total in 1i128..=1_000_000_000_000_000, duration in 1u32..=1_000_000) {
            prop_assert_eq!(vested_amount(total, 0, duration, duration), Some(total));
        }
    }
}
