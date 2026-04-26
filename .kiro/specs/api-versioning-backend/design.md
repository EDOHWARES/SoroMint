# API Versioning Backend Bugfix Design

## Overview

SoroMint's Soroban contracts currently have no versioning strategy: every public function is
exposed as a flat, unversioned entry point. When breaking changes are needed, all callers break
simultaneously with no migration path. This fix adds v2 entry points to the `SoroMintToken` and
`TokenFactory` contracts, updates `version()` to return `"2.0.0"` on upgraded contracts, and
documents the v1-to-v2 delta in `docs/contract-api.md` — while leaving every existing v1 entry
point fully operational.

## Glossary

- **Bug_Condition (C)**: A deployed contract is called by a client that relies on a v1 interface
  after a breaking change has been introduced, and no v1 compatibility shim exists.
- **Property (P)**: After the fix, every v1 entry point on a v2-capable contract returns the
  same result as it did before the versioning change was applied.
- **Preservation**: All existing v1 function signatures, argument types, return types, and
  observable side-effects remain unchanged on v2-capable contracts.
- **SoroMintToken**: The token contract in `contracts/token/src/lib.rs` whose `version()` currently
  returns `"1.0.0"`.
- **TokenFactory**: The factory contract in `contracts/factory/src/factory.rs` whose `version()`
  currently returns `"1.0.0"`.
- **v1 entry point**: Any public `#[contractimpl]` function present before this change.
- **v2 entry point**: A new public function added by this change, prefixed with `v2_` or
  otherwise namespaced to signal the new interface version.
- **version()**: The introspection function that returns a semver string identifying the active
  interface version.

## Bug Details

### Bug Condition

The bug manifests when a breaking change is introduced to a contract's public interface. Because
no versioned entry points exist, every existing caller immediately receives an invocation error
or incorrect result with no migration path. The contracts also return `"1.0.0"` from `version()`
regardless of what interface is actually deployed, making it impossible for clients to detect
which version they are talking to.

**Formal Specification:**
```
FUNCTION isBugCondition(contract, call)
  INPUT: contract — a deployed SoroMintToken or TokenFactory instance
         call    — an on-chain invocation of any public function
  OUTPUT: boolean

  RETURN contract.version() == "1.0.0"
         AND v2EntryPointsExist(contract) == false
         AND breakingChangeIntroduced(contract) == true
END FUNCTION
```

### Examples

- **Token version check**: `token.version()` returns `"1.0.0"` even after v2 functions are
  needed — client cannot detect the upgrade.
- **Missing v2 mint signature**: A v2 `mint` with an additional `memo: String` parameter does
  not exist; callers that need it have no entry point to call.
- **Factory hard cutover**: Updating `create_token` to accept a new parameter breaks every
  existing caller because no `v1_create_token` shim is preserved.
- **Edge case — version() called without auth**: Must continue to return a semver string with
  no authorization required, regardless of version.

## Expected Behavior

### Preservation Requirements

**Unchanged Behaviors:**
- All existing v1 function signatures (`initialize`, `mint`, `transfer`, `burn`, `burn_from`,
  `approve`, `allowance`, `balance`, `decimals`, `name`, `symbol`, `supply`, `pause`,
  `unpause`, `set_fee_config`, `fee_config`, `set_metadata_hash`, `metadata_hash`,
  `transfer_ownership` on the token; `initialize`, `create_token`, `get_tokens`,
  `update_wasm_hash` on the factory) must continue to work exactly as before.
- `status()` must continue to return `"alive"` on both contracts without authorization.
- `version()` must continue to return a semver-formatted string without authorization
  (the value changes from `"1.0.0"` to `"2.0.0"` — that change is intentional and is
  part of the fix, not a regression).
- The factory's `create_token` flow must continue to deploy and initialize token contracts
  correctly.
- All existing events emitted by v1 functions must continue to be emitted with the same
  topics and payloads.

**Scope:**
All inputs that do NOT involve the new v2 entry points should be completely unaffected by
this fix. This includes:
- Any call to an existing v1 function with valid arguments
- Any call to `version()` or `status()` (introspection only)
- Any factory deployment flow using the existing `create_token` signature

## Hypothesized Root Cause

Based on the bug description, the most likely issues are:

1. **No versioned namespacing**: The contracts expose a single flat `#[contractimpl]` block
   with no mechanism to distinguish v1 from v2 callers. Soroban does not provide built-in
   function namespacing, so versioning must be implemented by adding explicitly named v2
   functions (e.g., `v2_mint`, `v2_create_token`).

2. **Hard-coded version string**: Both contracts return `"1.0.0"` from a hard-coded string
   literal. There is no storage-backed or compile-time constant version, so updating the
   version requires a code change and redeployment — which is correct, but the value must
   be updated to `"2.0.0"` as part of this fix.

3. **No migration documentation**: There is no `docs/contract-api.md` file documenting the
   v1-to-v2 delta, so clients have no reference for planning upgrades.

4. **No v2 entry points defined**: The contracts have no `v2_*` functions at all. The fix
   must add at least one meaningful v2 entry point per contract to demonstrate the pattern,
   while keeping all v1 functions intact.

## Correctness Properties

Property 1: Bug Condition - v2 Entry Points Exist and version() Reports "2.0.0"

_For any_ deployed `SoroMintToken` or `TokenFactory` contract that has been upgraded under
this fix, calling `version()` SHALL return `"2.0.0"` and at least one `v2_*` entry point
SHALL be invocable, confirming that the v2 interface surface is present.

**Validates: Requirements 2.1, 2.3**

Property 2: Preservation - v1 Entry Points Unchanged on v2-Capable Contracts

_For any_ input where the bug condition does NOT hold (i.e., the call targets an existing v1
function with valid arguments), the fixed contracts SHALL produce exactly the same result —
same return value, same storage mutations, same emitted events — as the original pre-versioning
contracts, preserving full backward compatibility for all v1 callers.

**Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5**

## Fix Implementation

### Changes Required

Assuming our root cause analysis is correct:

**File**: `contracts/token/src/lib.rs`

**Function**: `version` + new `v2_*` functions

**Specific Changes**:
1. **Update version string**: Change `String::from_str(&e, "1.0.0")` to
   `String::from_str(&e, "2.0.0")` in `SoroMintToken::version`.
2. **Add v2 mint entry point**: Add `pub fn v2_mint(e: Env, to: Address, amount: i128, memo: String)`
   that validates the memo, then delegates to the existing mint logic. This demonstrates the
   v2 pattern without altering the v1 `mint` function.
3. **Preserve all v1 functions**: No existing function signatures, bodies, or storage keys
   are modified.

---

**File**: `contracts/factory/src/factory.rs`

**Function**: `version` + new `v2_*` functions

**Specific Changes**:
1. **Update version string**: Change `String::from_str(&e, "1.0.0")` to
   `String::from_str(&e, "2.0.0")` in `TokenFactory::version`.
2. **Add v2 create_token entry point**: Add
   `pub fn v2_create_token(e: Env, salt: BytesN<32>, admin: Address, decimal: u32, name: String, symbol: String, metadata_hash: String) -> Address`
   that calls the existing deployment logic and then invokes `set_metadata_hash` on the new
   token. This demonstrates the v2 pattern without altering the v1 `create_token` function.
3. **Preserve all v1 functions**: No existing function signatures, bodies, or storage keys
   are modified.

---

**File**: `docs/contract-api.md` *(new file)*

**Specific Changes**:
1. **Create migration document**: Document all v1 entry points, their v2 equivalents (where
   applicable), the new `v2_*` functions, and the version bump rationale.

## Testing Strategy

### Validation Approach

The testing strategy follows a two-phase approach: first, surface counterexamples that
demonstrate the bug on unfixed code (missing v2 entry points, wrong version string), then
verify the fix works correctly and preserves all existing v1 behavior.

### Exploratory Bug Condition Checking

**Goal**: Surface counterexamples that demonstrate the bug BEFORE implementing the fix.
Confirm or refute the root cause analysis. If we refute, we will need to re-hypothesize.

**Test Plan**: Write tests that call `version()` on the current contracts and assert it
returns `"2.0.0"`, and attempt to invoke `v2_mint` / `v2_create_token` — both will fail on
unfixed code. Run these tests on the UNFIXED code to observe failures and confirm root cause.

**Test Cases**:
1. **Token version test**: Call `token.version()` and assert `"2.0.0"` — will fail on unfixed
   code (returns `"1.0.0"`).
2. **Factory version test**: Call `factory.version()` and assert `"2.0.0"` — will fail on
   unfixed code.
3. **v2_mint invocation test**: Call `token.v2_mint(to, amount, memo)` — will fail on unfixed
   code (function does not exist).
4. **v2_create_token invocation test**: Call `factory.v2_create_token(...)` — will fail on
   unfixed code.

**Expected Counterexamples**:
- `version()` returns `"1.0.0"` instead of `"2.0.0"`
- `v2_mint` / `v2_create_token` invocations panic with "function not found" or equivalent
- Possible causes: version string not updated, v2 functions not yet added

### Fix Checking

**Goal**: Verify that for all inputs where the bug condition holds, the fixed contracts
produce the expected behavior.

**Pseudocode:**
```
FOR ALL contract WHERE isBugCondition(contract, call) DO
  result := contract_fixed.version()
  ASSERT result == "2.0.0"

  result := contract_fixed.v2_mint(to, amount, memo)
  ASSERT expectedV2Behavior(result)

  result := contract_fixed.v2_create_token(salt, admin, decimal, name, symbol, metadata_hash)
  ASSERT expectedV2FactoryBehavior(result)
END FOR
```

### Preservation Checking

**Goal**: Verify that for all inputs where the bug condition does NOT hold (i.e., v1 function
calls), the fixed contracts produce the same result as the original contracts.

**Pseudocode:**
```
FOR ALL input WHERE NOT isBugCondition(contract, input) DO
  ASSERT contract_original(input) == contract_fixed(input)
END FOR
```

**Testing Approach**: Property-based testing is recommended for preservation checking because:
- It generates many test cases automatically across the input domain
- It catches edge cases that manual unit tests might miss
- It provides strong guarantees that behavior is unchanged for all non-buggy inputs

**Test Plan**: Observe behavior of all v1 functions on UNFIXED code first, then write
property-based tests capturing that behavior, then re-run on fixed code to confirm no
regressions.

**Test Cases**:
1. **v1 mint preservation**: Verify `mint(to, amount)` produces the same balance delta and
   events before and after the fix.
2. **v1 transfer preservation**: Verify `transfer(from, to, amount)` produces the same result.
3. **v1 create_token preservation**: Verify `create_token(salt, admin, decimal, name, symbol)`
   deploys and initializes a token identically before and after the fix.
4. **status() preservation**: Verify `status()` continues to return `"alive"` on both contracts.
5. **Fee config preservation**: Verify `set_fee_config` / `fee_config` round-trip is unchanged.

### Unit Tests

- Test `version()` returns `"2.0.0"` on both upgraded contracts
- Test `v2_mint` with a valid memo mints correctly and emits the expected event
- Test `v2_create_token` deploys a token and sets its metadata hash
- Test that calling `v2_mint` with an empty memo is handled (edge case)
- Test that `status()` still returns `"alive"` on both contracts

### Property-Based Tests

- Generate random `(to, amount)` pairs and verify `mint` produces the same supply delta on
  both original and fixed contracts (preservation of v1 mint)
- Generate random `(from, to, amount)` triples and verify `transfer` behavior is identical
  before and after the fix
- Generate random valid `create_token` arguments and verify the factory deploys tokens with
  the same address derivation and initialization on both versions
- Generate random non-versioning function calls and verify all produce identical results on
  original vs. fixed contracts

### Integration Tests

- Full flow: deploy factory → `create_token` (v1) → `mint` (v1) → `transfer` (v1) → verify
  all balances and events are correct on the v2-capable contract
- Full flow: deploy factory → `v2_create_token` → `v2_mint` → verify v2-specific behavior
  (metadata hash set, memo recorded)
- Context switching: call `version()` before and after upgrade, verify the string changes
  from `"1.0.0"` to `"2.0.0"` and no other observable state changes
- Verify `docs/contract-api.md` exists and contains entries for all v1 and v2 entry points
