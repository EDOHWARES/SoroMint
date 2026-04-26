# SoroMint Core Token Design

This document describes the design and implementation of the standard SoroMint token contract, which follows the SEP-41 fungible token interface.

## Overview

The SoroMint token is a standard fungible token contract built on Soroban. It provides essential features such as minting, burning, transfers, and allowances, ensuring interoperability with the broader Stellar ecosystem.

## Key Features

- **SEP-41 Compliance**: Implements the standard `TokenInterface` from `soroban-sdk`.
- **Administrative Control**: Includes an admin role for privileged operations like minting and ownership transfer.
- **Security-First**: Uses safe math for all numeric operations and enforces strict authorization.
- **Event-Driven**: Emits detailed events for all state-changing operations.

## Interface Implementation

### Standard SEP-41 Methods

| Method | Description | Authorization |
|--------|-------------|---------------|
| `allowance` | Returns the amount `spender` can spend from `from`. | None |
| `approve` | Sets the allowance for `spender` on `from`'s tokens. | `from` |
| `balance` | Returns the token balance of an address. | None |
| `transfer` | Transfers tokens from `from` to `to`. | `from` |
| `transfer_from` | Transfers tokens from `from` to `to` using allowance. | `spender` |
| `burn` | Burns tokens from `from`. | `from` |
| `burn_from` | Burns tokens from `from` using allowance. | `spender` |
| `decimals` | Returns the number of decimal places. | None |
| `name` | Returns the human-readable token name. | None |
| `symbol` | Returns the token ticker symbol. | None |

### Administrative Methods

| Method | Description | Authorization |
|--------|-------------|---------------|
| `initialize` | Initializes the contract with metadata and admin. | None (Once) |
| `mint` | Creates new tokens and assigns them to an address. | `admin` |
| `transfer_ownership`| Changes the contract administrator. | `admin` |
| `supply` | Returns the total circulating supply. | None |

## Security Assumptions

### 1. Safe Arithmetic
All numeric operations use `checked_add` and `checked_sub` to prevent integer overflows and underflows. In case of an overflow, the contract panics, reverting the transaction.

### 2. Authorization
The contract leverages Soroban's built-in `require_auth()` mechanism. 
- User-specific operations (transfer, approve, burn) require the holder's signature.
- Administrative operations (mint, transfer_ownership) require the admin's signature.
- `transfer_from` and `burn_from` require the spender's signature, provided they have sufficient allowance from the holder.

### 3. State Management
- **Persistent Storage**: Used for balances and allowances to ensure they persist beyond the temporary storage window.
- **Instance Storage**: Used for contract configuration (admin, supply, metadata) as it is frequently accessed and tied to the contract's lifecycle.

### 4. Initialization
The `initialize` function can only be called once. Any subsequent calls will panic, preventing unauthorized re-initialization.

## Testing Strategy

The contract is verified through a comprehensive test suite in `contracts/token/src/test.rs`, covering:
- Happy paths for all interface methods.
- Error conditions (insufficient balance, insufficient allowance).
- Security checks (unauthorized access, re-initialization).
- Edge cases (zero amounts, negative amounts, overflows).

Minimum test coverage target: **95%+**.
