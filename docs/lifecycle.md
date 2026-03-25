# Emergency Pausable Module

The SoroMint Lifecycle module implements the "Pausable" security pattern. It allows an authorized administrator (or a dedicated `Pauser` role) to freeze sensitive contract operations in the event of an emergency, vulnerability discovery, or critical migration.

## Core Concepts

- **State**: The module maintains a boolean `IsPaused` state in persistent storage.
- **Circuit Breaker**: The `require_not_paused()` guard is used to protect sensitive actions like `transfer` and `burn`.
- **Transparency**: Changes to the paused state emit events (`sys_pause`, `sys_unp`) for off-chain monitoring.

## Functions

### `pause(admin: Address)`

- **Action**: Sets the operational state to paused.
- **Authorization**: Requires the authorizing `admin`.
- **Event**: Emits `sys_pause` with `admin`.

### `unpause(admin: Address)`

- **Action**: Returns the operational state to active (unpaused).
- **Authorization**: Requires the authorizing `admin`.
- **Event**: Emits `sys_unp` with `admin`.

### `is_paused() -> bool`

- **Action**: Public view function to check the current operational state.

### `require_not_paused()`

- **Action**: Guard function that panics with `"Contract is paused"` if `is_paused()` is true.

## Integration

To integrate this module, simply call `require_not_paused(&e)` at the start of any state-mutating function that should be halted during an emergency (e.g., token transfers).
