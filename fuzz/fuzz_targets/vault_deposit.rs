#![no_main]
use libfuzzer_sys::fuzz_target;
#[path = "../../contracts/vault/src/math.rs"]
mod vault_math;

fuzz_target!(|data: &[u8]| {
    if data.len() < 48 {
        return;
    }
    let amount = i128::from_le_bytes(data[0..16].try_into().unwrap()).saturating_abs();
    let price = i128::from_le_bytes(data[16..32].try_into().unwrap()).saturating_abs();
    let debt = i128::from_le_bytes(data[32..48].try_into().unwrap()).saturating_abs();
    if let Some(value) = vault_math::collateral_value(amount, price, 10_000_000) {
        assert!(value >= 0);
        if debt > 0 {
            if let Some(ratio) = vault_math::collateralization_ratio(value, debt, 10_000) {
                assert!(ratio >= 0);
            }
        }
    }
});
