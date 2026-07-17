#![no_main]
use libfuzzer_sys::fuzz_target;
#[path = "../../contracts/streaming/src/math.rs"]
mod stream_math;

fuzz_target!(|data: &[u8]| {
    if data.len() < 28 {
        return;
    }
    let total = i128::from_le_bytes(data[0..16].try_into().unwrap()).saturating_abs();
    let start = u32::from_le_bytes(data[16..20].try_into().unwrap());
    let duration = u32::from_le_bytes(data[20..24].try_into().unwrap()).max(1);
    let offset = u32::from_le_bytes(data[24..28].try_into().unwrap());
    let Some(stop) = start.checked_add(duration) else {
        return;
    };
    let current = start.saturating_add(offset.min(duration));
    let Some(vested) = stream_math::vested_amount(total, start, stop, current) else {
        // Checked arithmetic deliberately rejects schedules whose intermediate
        // multiplication cannot be represented.
        return;
    };
    assert!((0..=total).contains(&vested));
    assert_eq!(
        stream_math::vested_amount(total, start, stop, stop),
        Some(total)
    );
    if current < stop {
        if let Some(next) = stream_math::vested_amount(total, start, stop, current + 1) {
            assert!(next >= vested);
        }
    }
});
