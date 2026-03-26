# Implementation Plan: Contract Versioning & Health

## Overview

Add `version()` and `status()` to all five SoroMint contracts. `token` and `factory` already have
implementations — they only need property-based tests added. `access`, `compliance`, and `ownership`
need a `#[contract]` wrapper struct, a `#[contractimpl]` block with `version()`/`status()` (plus
delegating wrappers for existing free functions), `crate-type = ["cdylib"]` in their `Cargo.toml`,
and NatSpec comments on all public functions. All five crates gain `proptest` as a dev-dependency.
The feature concludes with `docs/contract-api.md`.

## Tasks

- [x] 1. Add `proptest` dev-dependency and property tests to `token`
  - [x] 1.1 Add `proptest = "1"` to `[dev-dependencies]` in `contracts/token/Cargo.toml`
    - _Requirements: 4.1, 4.2, 4.3, 4.4_
  - [-]* 1.2 Write property test: version idempotence (Property 1)
    - Add `prop_version_idempotent` to `contracts/token/src/test.rs`
    - Tag: `// Feature: contract-versioning-health, Property 1: version idempotence`
    - Use `proptest!` macro with `_seed: u64` input; register `SoroMintToken`, assert `client.version() == client.version()`
    - **Property 1: Version idempotence**
    - **Validates: Requirements 1.3, 4.3**
  - [ ]* 1.3 Write property test: status idempotence (Property 2)
    - Add `prop_status_idempotent` to `contracts/token/src/test.rs`
    - Tag: `// Feature: contract-versioning-health, Property 2: status idempotence`
    - **Property 2: Status idempotence**
    - **Validates: Requirements 2.4, 4.4**
  - [ ]* 1.4 Write property test: version semver format (Property 3)
    - Add `prop_version_semver_format` to `contracts/token/src/test.rs`
    - Split returned string on `'.'`, assert 3 parts each parseable as `u64`
    - **Property 3: Version conforms to semver format**
    - **Validates: Requirements 1.2**
  - [ ]* 1.5 Write property test: status is always "alive" (Property 4)
    - Add `prop_status_is_alive` to `contracts/token/src/test.rs`
    - **Property 4: Status is always "alive"**
    - **Validates: Requirements 2.2**
  - [ ]* 1.6 Write property test: no auth required (Property 5)
    - Add `prop_no_auth_required` to `contracts/token/src/test.rs`
    - Do NOT call `e.mock_all_auths()`; assert both calls succeed without panic
    - **Property 5: Version and status require no authorization**
    - **Validates: Requirements 1.4, 2.3**

- [x] 2. Add `proptest` dev-dependency and property tests to `factory`
  - [x] 2.1 Add `proptest = "1"` to `[dev-dependencies]` in `contracts/factory/Cargo.toml`
    - _Requirements: 4.1, 4.2, 4.3, 4.4_
  - [ ]* 2.2 Write property test: version idempotence (Property 1)
    - Add `prop_version_idempotent` to `contracts/factory/src/test_factory.rs`
    - Tag: `// Feature: contract-versioning-health, Property 1: version idempotence`
    - Register `TokenFactory`, call `client.initialize(...)`, assert `client.version() == client.version()`
    - **Property 1: Version idempotence**
    - **Validates: Requirements 1.3, 4.3**
  - [ ]* 2.3 Write property test: status idempotence (Property 2)
    - Add `prop_status_idempotent` to `contracts/factory/src/test_factory.rs`
    - **Property 2: Status idempotence**
    - **Validates: Requirements 2.4, 4.4**
  - [ ]* 2.4 Write property test: version semver format (Property 3)
    - Add `prop_version_semver_format` to `contracts/factory/src/test_factory.rs`
    - **Property 3: Version conforms to semver format**
    - **Validates: Requirements 1.2**
  - [ ]* 2.5 Write property test: status is always "alive" (Property 4)
    - Add `prop_status_is_alive` to `contracts/factory/src/test_factory.rs`
    - **Property 4: Status is always "alive"**
    - **Validates: Requirements 2.2**
  - [ ]* 2.6 Write property test: no auth required (Property 5)
    - Add `prop_no_auth_required` to `contracts/factory/src/test_factory.rs`
    - Do NOT call `e.mock_all_auths()`; assert both calls succeed without panic
    - **Property 5: Version and status require no authorization**
    - **Validates: Requirements 1.4, 2.3**

- [-] 3. Checkpoint — token and factory tests pass
  - Ensure all tests pass for `token` and `factory` crates, ask the user if questions arise.

- [ ] 4. Implement `#[contract]` wrapper and `version()`/`status()` in `access`
  - [~] 4.1 Update `contracts/access/Cargo.toml`
    - Add `crate-type = ["cdylib"]` under `[lib]`
    - Add `proptest = "1"` to `[dev-dependencies]`
    - _Requirements: 3.3_
  - [~] 4.2 Add `AccessContract` wrapper struct and `#[contractimpl]` block to `contracts/access/src/access.rs`
    - Add `use soroban_sdk::{contract, contractimpl, String};` imports
    - Define `#[contract] pub struct AccessContract;`
    - Implement `#[contractimpl] impl AccessContract` with:
      - `version(e: Env) -> String` returning `"1.0.0"` with NatSpec `///` comment
      - `status(e: Env) -> String` returning `"alive"` with NatSpec `///` comment
      - Delegating wrappers for `initialize_admin`, `grant_role`, `revoke_role`, `has_role`, `require_role` with NatSpec comments
    - Ensure all existing free functions retain their NatSpec comments
    - _Requirements: 1.1, 1.2, 1.4, 1.5, 2.1, 2.2, 2.3, 2.5, 3.3, 6.1, 6.2, 6.3, 6.4, 6.5_
  - [~] 4.3 Add unit tests for `version` and `status` to `contracts/access/src/test_access.rs`
    - Add `test_version_returns_expected` — assert `client.version() == "1.0.0"` using `AccessContract`
    - Add `test_status_returns_alive` — assert `client.status() == "alive"`
    - Add `test_version_idempotent` — call `version()` twice, assert equal
    - Add `test_status_idempotent` — call `status()` twice, assert equal
    - _Requirements: 4.1, 4.2, 4.3, 4.4_
  - [ ]* 4.4 Write property test: version idempotence (Property 1)
    - Add `prop_version_idempotent` to `contracts/access/src/test_access.rs`
    - Tag: `// Feature: contract-versioning-health, Property 1: version idempotence`
    - Register `AccessContract`
    - **Property 1: Version idempotence**
    - **Validates: Requirements 1.3, 4.3**
  - [ ]* 4.5 Write property test: status idempotence (Property 2)
    - Add `prop_status_idempotent` to `contracts/access/src/test_access.rs`
    - **Property 2: Status idempotence**
    - **Validates: Requirements 2.4, 4.4**
  - [ ]* 4.6 Write property test: version semver format (Property 3)
    - Add `prop_version_semver_format` to `contracts/access/src/test_access.rs`
    - **Property 3: Version conforms to semver format**
    - **Validates: Requirements 1.2**
  - [ ]* 4.7 Write property test: status is always "alive" (Property 4)
    - Add `prop_status_is_alive` to `contracts/access/src/test_access.rs`
    - **Property 4: Status is always "alive"**
    - **Validates: Requirements 2.2**
  - [ ]* 4.8 Write property test: no auth required (Property 5)
    - Add `prop_no_auth_required` to `contracts/access/src/test_access.rs`
    - Do NOT call `e.mock_all_auths()`
    - **Property 5: Version and status require no authorization**
    - **Validates: Requirements 1.4, 2.3**

- [ ] 5. Implement `#[contract]` wrapper and `version()`/`status()` in `compliance`
  - [~] 5.1 Update `contracts/compliance/Cargo.toml`
    - Add `crate-type = ["cdylib"]` under `[lib]`
    - Add `proptest = "1"` to `[dev-dependencies]`
    - _Requirements: 3.4_
  - [~] 5.2 Add `ComplianceContract` wrapper struct and `#[contractimpl]` block to `contracts/compliance/src/compliance.rs`
    - Add `use soroban_sdk::{contract, contractimpl, String};` imports
    - Define `#[contract] pub struct ComplianceContract;`
    - Implement `#[contractimpl] impl ComplianceContract` with:
      - `version(e: Env) -> String` returning `"1.0.0"` with NatSpec comment
      - `status(e: Env) -> String` returning `"alive"` with NatSpec comment
      - Delegating wrappers for `set_blacklist_status`, `is_blacklisted`, `require_not_blacklisted` with NatSpec comments
    - Ensure all existing free functions retain their NatSpec comments
    - _Requirements: 1.1, 1.2, 1.4, 1.5, 2.1, 2.2, 2.3, 2.5, 3.4, 6.1, 6.2, 6.3, 6.4, 6.5_
  - [~] 5.3 Add unit tests for `version` and `status` to `contracts/compliance/src/test_compliance.rs`
    - Add `test_version_returns_expected`, `test_status_returns_alive`, `test_version_idempotent`, `test_status_idempotent` using `ComplianceContract`
    - _Requirements: 4.1, 4.2, 4.3, 4.4_
  - [ ]* 5.4 Write property test: version idempotence (Property 1)
    - Add `prop_version_idempotent` to `contracts/compliance/src/test_compliance.rs`
    - **Property 1: Version idempotence**
    - **Validates: Requirements 1.3, 4.3**
  - [ ]* 5.5 Write property test: status idempotence (Property 2)
    - Add `prop_status_idempotent` to `contracts/compliance/src/test_compliance.rs`
    - **Property 2: Status idempotence**
    - **Validates: Requirements 2.4, 4.4**
  - [ ]* 5.6 Write property test: version semver format (Property 3)
    - Add `prop_version_semver_format` to `contracts/compliance/src/test_compliance.rs`
    - **Property 3: Version conforms to semver format**
    - **Validates: Requirements 1.2**
  - [ ]* 5.7 Write property test: status is always "alive" (Property 4)
    - Add `prop_status_is_alive` to `contracts/compliance/src/test_compliance.rs`
    - **Property 4: Status is always "alive"**
    - **Validates: Requirements 2.2**
  - [ ]* 5.8 Write property test: no auth required (Property 5)
    - Add `prop_no_auth_required` to `contracts/compliance/src/test_compliance.rs`
    - Do NOT call `e.mock_all_auths()`
    - **Property 5: Version and status require no authorization**
    - **Validates: Requirements 1.4, 2.3**

- [ ] 6. Implement `#[contract]` wrapper and `version()`/`status()` in `ownership`
  - [~] 6.1 Update `contracts/ownership/Cargo.toml`
    - Add `crate-type = ["cdylib"]` under `[lib]`
    - Add `proptest = "1"` to `[dev-dependencies]`
    - _Requirements: 3.5_
  - [~] 6.2 Add `OwnershipContract` wrapper struct and `#[contractimpl]` block to `contracts/ownership/src/ownership.rs`
    - Add `use soroban_sdk::{contract, contractimpl, String};` imports
    - Define `#[contract] pub struct OwnershipContract;`
    - Implement `#[contractimpl] impl OwnershipContract` with:
      - `version(e: Env) -> String` returning `"1.0.0"` with NatSpec comment
      - `status(e: Env) -> String` returning `"alive"` with NatSpec comment
      - Delegating wrappers for `initialize_owner`, `transfer_ownership`, `accept_ownership`, `get_owner`, `get_pending_owner` with NatSpec comments
    - Ensure all existing free functions retain their NatSpec comments
    - _Requirements: 1.1, 1.2, 1.4, 1.5, 2.1, 2.2, 2.3, 2.5, 3.5, 6.1, 6.2, 6.3, 6.4, 6.5_
  - [~] 6.3 Add unit tests for `version` and `status` to `contracts/ownership/src/test_ownership.rs`
    - Add `test_version_returns_expected`, `test_status_returns_alive`, `test_version_idempotent`, `test_status_idempotent` using `OwnershipContract`
    - _Requirements: 4.1, 4.2, 4.3, 4.4_
  - [ ]* 6.4 Write property test: version idempotence (Property 1)
    - Add `prop_version_idempotent` to `contracts/ownership/src/test_ownership.rs`
    - **Property 1: Version idempotence**
    - **Validates: Requirements 1.3, 4.3**
  - [ ]* 6.5 Write property test: status idempotence (Property 2)
    - Add `prop_status_idempotent` to `contracts/ownership/src/test_ownership.rs`
    - **Property 2: Status idempotence**
    - **Validates: Requirements 2.4, 4.4**
  - [ ]* 6.6 Write property test: version semver format (Property 3)
    - Add `prop_version_semver_format` to `contracts/ownership/src/test_ownership.rs`
    - **Property 3: Version conforms to semver format**
    - **Validates: Requirements 1.2**
  - [ ]* 6.7 Write property test: status is always "alive" (Property 4)
    - Add `prop_status_is_alive` to `contracts/ownership/src/test_ownership.rs`
    - **Property 4: Status is always "alive"**
    - **Validates: Requirements 2.2**
  - [ ]* 6.8 Write property test: no auth required (Property 5)
    - Add `prop_no_auth_required` to `contracts/ownership/src/test_ownership.rs`
    - Do NOT call `e.mock_all_auths()`
    - **Property 5: Version and status require no authorization**
    - **Validates: Requirements 1.4, 2.3**

- [~] 7. Checkpoint — all five contracts compile and tests pass
  - Ensure all tests pass across all five contract crates, ask the user if questions arise.

- [ ] 8. Create `docs/contract-api.md`
  - [~] 8.1 Create `docs/contract-api.md` at the repository root
    - Include a section per contract (`token`, `factory`, `access`, `compliance`, `ownership`)
    - Each section lists all public functions with: signature, parameters, return type, plain-English description
    - Document `version()` and `status()` for every contract with example return values
    - For functions requiring authorization, explicitly state which role/address must authorize
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5_

- [~] 9. Final checkpoint — full test suite passes
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for a faster MVP
- `token` and `factory` already have `version()`/`status()` implementations — tasks 1 and 2 only add property tests
- `access`, `compliance`, and `ownership` use the same `#[contract]` wrapper pattern already present in their test files
- Each property test references a specific property from the design document for traceability
- Unit tests use concrete assertions; property tests use `proptest!` with `_seed: u64` to drive randomness
