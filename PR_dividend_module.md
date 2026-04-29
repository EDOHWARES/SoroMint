# Feat: Implement Dividend Distribution Module

## Description

This PR introduces the **Dividend Distribution Module**, allowing token issuers to deposit XLM which is then proportionally distributed to all SoroMint token holders.

Because enumerating all token holders on-chain is computationally unfeasible, this module utilizes an **O(1) Dividends-Per-Share (DPS) accumulator** pattern.

### Key Features & Changes

*   **Smart Contracts (`contracts/dividend/*`)**:
    *   Implemented `DividendDistributor` contract.
    *   Math uses `10^13` precision scaling to safely prevent integer truncation, even when small amounts of XLM are distributed over large token supplies.
    *   Gas-optimized: `total_supply` and `holder_balance` are provided by the caller to bypass expensive cross-contract reads.
    *   XLM transfers handle safely through `token::Client` as SEP-41 assets.
*   **Backend Integration (`server/routes/dividend-routes.js`)**:
    *   Added 4 REST endpoints (`/stats`, `/claimable/:holderAddress`, `/deposit`, `/claim`).
    *   Implemented standard project patterns (JWT auth, `express-validator` style assertions via `AppError`, structured winston logging).
    *   Transaction endpoints return structured data ready for Freighter XDR building on the frontend.
*   **Testing**:
    *   12 comprehensive test cases utilizing the `soroban-sdk` 22 API (`register_stellar_asset_contract`).
    *   Tested proportional splits, zero balances, late joiners, and boundary limits.
*   **Workspace Integration**:
    *   Registered `contracts/dividend` in root `Cargo.toml`.

## Verification Steps

1. Verify the project builds via `cargo build --target wasm32-unknown-unknown --release -p soromint-dividend`.
2. Run tests to confirm logic: `cargo test -p soromint-dividend`.
3. Check the backend integration by spinning up the server and navigating to the `/api/dividend/stats` route.

Closes #190
