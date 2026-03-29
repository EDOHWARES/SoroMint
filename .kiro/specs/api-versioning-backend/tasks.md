# Implementation Plan

- [x] 1. Write bug condition exploration test
  - **Property 1: Bug Condition** - v2 Entry Points Absent and version() Reports "1.0.0"
  - **CRITICAL**: This test MUST FAIL on unfixed code — failure confirms the bug exists
  - **DO NOT attempt to fix the test or the code when it fails**
  - **NOTE**: This test encodes the expected behavior — it will validate the fix when it passes after implementation
  - **GOAL**: Surface counterexamples that demonstrate the bug exists
  - **Scoped PBT Approach**: Scope the property to the concrete failing cases — version() == "1.0.0" and v2_mint / v2_create_token absent
  - In `contracts/token/src/test.rs`, add a test that calls `SoroMintToken::version()` and asserts the result equals `"2.0.0"` (isBugCondition: contract.version() == "1.0.0" AND v2EntryPointsExist == false)
  - In `contracts/token/src/test.rs`, add a test that invokes `SoroMintToken::v2_mint(to, amount, memo)` and asserts it succeeds (will panic on unfixed code — function does not exist)
  - In `contracts/factory/src/test_factory.rs`, add a test that calls `TokenFactory::version()` and asserts `"2.0.0"`
  - In `contracts/factory/src/test_factory.rs`, add a test that invokes `TokenFactory::v2_create_token(salt, admin, decimal, name, symbol, metadata_hash)` and asserts it returns a valid address
  - Run tests on UNFIXED code: `cargo test -p soromint-token -- v2` and `cargo test -p soromint-factory -- v2`
  - **EXPECTED OUTCOME**: Tests FAIL (version returns "1.0.0", v2 functions do not exist — this proves the bug exists)
  - Document counterexamples found (e.g., "version() returns '1.0.0' instead of '2.0.0'", "v2_mint panics with function not found")
  - Mark task complete when tests are written, run, and failures are documented
  - _Requirements: 1.1, 1.4, 2.1, 2.3_

- [x] 2. Write preservation property tests (BEFORE implementing fix)
  - **Property 2: Preservation** - v1 Entry Points Unchanged on v2-Capable Contracts
  - **IMPORTANT**: Follow observation-first methodology — run UNFIXED code with non-buggy inputs first
  - Observe: `mint(to, 100)` increases balance by 100 and supply by 100 on unfixed code
  - Observe: `transfer(from, to, 50)` moves 50 tokens with correct balance deltas on unfixed code
  - Observe: `create_token(salt, admin, decimal, name, symbol)` deploys and initializes a token on unfixed code
  - Observe: `status()` returns `"alive"` on both contracts on unfixed code
  - Observe: `fee_config` round-trip (set then get) returns the same struct on unfixed code
  - In `contracts/token/src/test.rs`, write property-based tests: for all valid `(to, amount)` where amount > 0, `mint` produces balance delta == amount and supply delta == amount (¬C(X): v2 functions not involved)
  - In `contracts/token/src/test.rs`, write property-based tests: for all valid `(from, to, amount)` with sufficient balance, `transfer` produces correct balance deltas and emits transfer event
  - In `contracts/factory/src/test_factory.rs`, write property-based tests: for all valid `create_token` argument sets, factory deploys a token with correct initialization
  - In `contracts/token/src/test.rs` and `contracts/factory/src/test_factory.rs`, assert `status()` returns `"alive"` without auth
  - Run tests on UNFIXED code: `cargo test -p soromint-token -- preservation` and `cargo test -p soromint-factory -- preservation`
  - **EXPECTED OUTCOME**: Tests PASS (confirms baseline v1 behavior to preserve)
  - Mark task complete when tests are written, run, and passing on unfixed code
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5_

- [~] 3. Fix for missing v2 entry points and stale version string

  - [x] 3.1 Checkout a new git branch for issue #64
    - Run `git checkout -b fix/issue-64-api-versioning`
    - _Requirements: 2.1, 2.3_

  - [x] 3.2 Add v2_mint to contracts/token/src/lib.rs and bump version() to "2.0.0"
    - In `SoroMintToken`, add `pub fn v2_mint(e: Env, to: Address, amount: i128, memo: String)` that validates memo is non-empty, then delegates to the existing mint logic (require_not_paused, admin.require_auth, balance/supply update, emit event)
    - Change `version()` to return `String::from_str(&e, "2.0.0")`
    - Leave ALL existing v1 functions (`initialize`, `mint`, `transfer`, `burn`, `burn_from`, `approve`, `allowance`, `balance`, `decimals`, `name`, `symbol`, `supply`, `pause`, `unpause`, `set_fee_config`, `fee_config`, `set_metadata_hash`, `metadata_hash`, `transfer_ownership`) completely unchanged
    - _Bug_Condition: isBugCondition(contract) where contract.version() == "1.0.0" AND v2EntryPointsExist == false_
    - _Expected_Behavior: version() returns "2.0.0"; v2_mint(to, amount, memo) mints correctly and is invocable_
    - _Preservation: All v1 function signatures, storage keys, return types, and emitted events remain identical_
    - _Requirements: 2.1, 2.2, 2.3, 3.1, 3.2, 3.3, 3.4_

  - [x] 3.3 Add v2_create_token to contracts/factory/src/factory.rs and bump version() to "2.0.0"
    - In `TokenFactory`, add `pub fn v2_create_token(e: Env, salt: BytesN<32>, admin: Address, decimal: u32, name: String, symbol: String, metadata_hash: String) -> Address` that calls the existing deployment logic then invokes `set_metadata_hash` on the new token
    - Change `version()` to return `String::from_str(&e, "2.0.0")`
    - Leave ALL existing v1 functions (`initialize`, `create_token`, `get_tokens`, `update_wasm_hash`) completely unchanged
    - _Bug_Condition: isBugCondition(contract) where contract.version() == "1.0.0" AND v2EntryPointsExist == false_
    - _Expected_Behavior: version() returns "2.0.0"; v2_create_token(..., metadata_hash) deploys token and sets its metadata hash_
    - _Preservation: All v1 factory function signatures, storage keys, return types, and emitted events remain identical_
    - _Requirements: 2.1, 2.2, 2.3, 3.1, 3.3, 3.5_

  - [-] 3.4 Create docs/contract-api.md documenting v1 and v2 entry points
    - Create `docs/contract-api.md` with sections for SoroMintToken and TokenFactory
    - Document all v1 entry points (signature, arguments, return type, behavior)
    - Document all v2 entry points (`v2_mint`, `v2_create_token`) with their new parameters
    - Include a v1-to-v2 migration delta section explaining what changed and why
    - Document the version bump rationale (1.0.0 → 2.0.0)
    - _Requirements: 2.4_

  - [~] 3.5 Verify bug condition exploration test now passes
    - **Property 1: Expected Behavior** - v2 Entry Points Exist and version() Reports "2.0.0"
    - **IMPORTANT**: Re-run the SAME tests from task 1 — do NOT write new tests
    - Run: `cargo test -p soromint-token -- v2` and `cargo test -p soromint-factory -- v2`
    - **EXPECTED OUTCOME**: Tests PASS (confirms version() returns "2.0.0" and v2_mint / v2_create_token are invocable)
    - _Requirements: 2.1, 2.3_

  - [~] 3.6 Verify preservation tests still pass
    - **Property 2: Preservation** - v1 Entry Points Unchanged on v2-Capable Contracts
    - **IMPORTANT**: Re-run the SAME tests from task 2 — do NOT write new tests
    - Run: `cargo test -p soromint-token -- preservation` and `cargo test -p soromint-factory -- preservation`
    - **EXPECTED OUTCOME**: Tests PASS (confirms no regressions in any v1 function)
    - Confirm all v1 behavior (mint, transfer, burn, create_token, status, fee_config) is identical after the fix

- [~] 4. Checkpoint — Ensure all tests pass
  - Run the full test suite: `cargo test --workspace`
  - Confirm all existing snapshot tests still pass (no snapshot diffs)
  - Confirm bug condition exploration tests (task 1) now pass
  - Confirm preservation property tests (task 2) still pass
  - Push branch and open PR for issue #64: `git push -u origin fix/issue-64-api-versioning`
  - Ensure all tests pass; ask the user if questions arise
