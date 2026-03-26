# Requirements Document

## Introduction

This feature adds two public introspection functions — `version()` and `status()` — to every SoroMint
Soroban smart contract (`token`, `factory`, `access`, `compliance`, `ownership`). The functions allow
front-end dashboards, back-end services, and developer tooling to query a contract's current version
string and liveness status without any privileged authorization. A companion API reference document
(`docs/contract-api.md`) and NatSpec-style inline comments are included. All new code must be covered
by tests at ≥ 95 %.

## Glossary

- **Contract**: Any Soroban smart contract in the SoroMint workspace (`token`, `factory`, `access`,
  `compliance`, `ownership`).
- **Version_String**: A semver-formatted string (e.g., `"1.0.0"`) that identifies the deployed
  contract revision.
- **Status_String**: A fixed string (`"alive"`) returned by a healthy contract to signal liveness.
- **Caller**: Any external account, contract, or service that invokes a Contract function.
- **NatSpec_Comment**: A Rust doc-comment (`///`) placed immediately above a public function that
  describes its purpose, arguments, and return value.
- **API_Doc**: The Markdown file `docs/contract-api.md` that documents all public Contract functions.
- **Test_Suite**: The `#[cfg(test)]` module(s) within each contract crate.

---

## Requirements

### Requirement 1: Version Function

**User Story:** As a developer building a monitoring dashboard, I want to call `version()` on any
SoroMint contract, so that I can display which contract revision is currently deployed.

#### Acceptance Criteria

1. THE Contract SHALL expose a public function named `version` that accepts only an `Env` argument
   and returns a `soroban_sdk::String`.
2. WHEN `version` is invoked, THE Contract SHALL return a Version_String that conforms to semver
   format `MAJOR.MINOR.PATCH` (e.g., `"1.0.0"`).
3. WHEN `version` is invoked, THE Contract SHALL return the same Version_String on every successive
   call within the same ledger (idempotence).
4. WHEN `version` is invoked, THE Contract SHALL return the Version_String without requiring any
   authorization from the Caller.
5. THE Contract SHALL include a NatSpec_Comment above the `version` function that documents its
   purpose and return value.

---

### Requirement 2: Status Function

**User Story:** As a back-end service operator, I want to call `status()` on any SoroMint contract,
so that I can confirm the contract is live and responsive before routing user transactions to it.

#### Acceptance Criteria

1. THE Contract SHALL expose a public function named `status` that accepts only an `Env` argument
   and returns a `soroban_sdk::String`.
2. WHEN `status` is invoked on a deployed Contract, THE Contract SHALL return the Status_String
   `"alive"`.
3. WHEN `status` is invoked, THE Contract SHALL return the Status_String without requiring any
   authorization from the Caller.
4. WHEN `status` is invoked, THE Contract SHALL return the same Status_String on every successive
   call within the same ledger (idempotence).
5. THE Contract SHALL include a NatSpec_Comment above the `status` function that documents its
   purpose and return value.

---

### Requirement 3: Coverage Across All Contracts

**User Story:** As a project maintainer, I want `version()` and `status()` present in every contract,
so that monitoring tooling can use a uniform interface regardless of which contract it queries.

#### Acceptance Criteria

1. THE token Contract SHALL implement both `version` and `status` functions satisfying Requirements 1
   and 2.
2. THE factory Contract SHALL implement both `version` and `status` functions satisfying Requirements
   1 and 2.
3. THE access Contract SHALL implement both `version` and `status` functions satisfying Requirements
   1 and 2.
4. THE compliance Contract SHALL implement both `version` and `status` functions satisfying
   Requirements 1 and 2.
5. THE ownership Contract SHALL implement both `version` and `status` functions satisfying
   Requirements 1 and 2.

---

### Requirement 4: Test Coverage

**User Story:** As a project maintainer, I want automated tests for `version()` and `status()` in
every contract's Test_Suite, so that regressions are caught before deployment.

#### Acceptance Criteria

1. WHEN the Test_Suite for a Contract is executed, THE Test_Suite SHALL include at least one test
   that asserts `version()` returns a non-empty Version_String matching the expected semver value.
2. WHEN the Test_Suite for a Contract is executed, THE Test_Suite SHALL include at least one test
   that asserts `status()` returns the Status_String `"alive"`.
3. WHEN `version` is called twice in the same test environment, THE Test_Suite SHALL assert that
   both calls return identical strings (round-trip / idempotence property).
4. WHEN `status` is called twice in the same test environment, THE Test_Suite SHALL assert that
   both calls return identical strings (idempotence property).
5. THE Test_Suite for each Contract SHALL achieve a line coverage of at least 95 % across all
   source files in that contract crate.

---

### Requirement 5: API Documentation

**User Story:** As a front-end developer integrating with SoroMint contracts, I want a single
reference document that describes all public contract functions including `version()` and `status()`,
so that I can integrate without reading Rust source code.

#### Acceptance Criteria

1. THE API_Doc SHALL exist at the path `docs/contract-api.md` in the repository root.
2. THE API_Doc SHALL contain a dedicated section for each Contract listing its public functions,
   their signatures, parameters, return types, and a plain-English description.
3. THE API_Doc SHALL document the `version` function for every Contract, including its return type
   and an example return value.
4. THE API_Doc SHALL document the `status` function for every Contract, including its return type
   and an example return value.
5. WHEN a Contract function requires authorization, THE API_Doc SHALL explicitly state which role
   or address must authorize the call.

---

### Requirement 6: Inline NatSpec Comments

**User Story:** As a Rust developer reviewing contract source code, I want NatSpec-style doc-comments
on every public function, so that I can understand intent without consulting external documentation.

#### Acceptance Criteria

1. THE Contract SHALL include a NatSpec_Comment (`///`) immediately above every `pub fn` in its
   `#[contractimpl]` block.
2. WHEN a public function accepts arguments, THE NatSpec_Comment SHALL include a `# Arguments`
   section listing each parameter name and its purpose.
3. WHEN a public function returns a value, THE NatSpec_Comment SHALL include a `# Returns` section
   describing the return type and its meaning.
4. WHEN a public function requires authorization, THE NatSpec_Comment SHALL include an
   `# Authorization` section stating which address or role must sign.
5. IF a public function can panic, THEN THE NatSpec_Comment SHALL include a `# Panics` section
   describing the panic condition.
