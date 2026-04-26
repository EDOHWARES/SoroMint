# SoroMint Contracts Guide

Welcome to the SoroMint contract documentation. This guide provides a human-readable overview of the core smart contracts in the SoroMint ecosystem, their primary functions, and how to interact with them.

## Table of Contents
1. [Token Contract](#token-contract)
2. [Vault Contract](#vault-contract)
3. [Multi-Sig Admin](#multi-sig-admin)
4. [AMM Pool](#amm-pool)
5. [Lending Pool](#lending-pool)
6. [Dividend Distributor](#dividend-distributor)
7. [Streaming Payments](#streaming-payments)
8. [Lottery](#lottery)

---

## Token Contract
The core SoroMint token contract, implementing the standard `TokenInterface` with additional administrative controls and transfer taxes.

### Key Functions
- `initialize(admin, decimals, name, symbol)`: Sets up the token.
- `mint(to, amount)`: Admin-only function to mint new tokens.
- `set_fee_config(enabled, fee_bps, treasury)`: Configures a transfer tax.
- `set_minter_limit(minter, limit)`: Sets a 24-hour minting cap for a specific role.
- `transfer(from, to, amount)`: Moves tokens between accounts.

---

## Vault Contract
A collateralized debt position (CDP) contract allowing users to mint SoroMint (SMT) tokens by depositing supported collateral (e.g., XLM).

### Key Functions
- `initialize(admin, smt_token, oracle)`: Sets up the vault system.
- `add_collateral(token, min_ratio, threshold, penalty)`: (Admin) Adds support for a new collateral type.
- `deposit_and_mint(user, token, coll_amount, smt_amount)`: Creates a new vault and mints SMT.
- `repay_and_withdraw(vault_id, repay, token, withdraw)`: Manages debt and collateral.
- `liquidate(vault_id, liquidator, debt_to_cover)`: Allows liquidators to seize under-collateralized positions.

---

## Multi-Sig Admin
A governance contract requiring multiple authorized signers to approve and execute transactions.

### Key Functions
- `initialize(signers, threshold)`: Sets up the signers and execution threshold.
- `propose_tx(proposer, target, function, args)`: Proposes a new action.
- `approve_tx(signer, tx_id)`: Casts a vote for a proposed transaction.
- `execute_tx(executor, tx_id)`: Executes the transaction if the threshold is met.

---

## AMM Pool
A constant-product automated market maker (AMM) for swapping asset pairs.

### Key Functions
- `initialize(factory, token, quote_token, fee_bps)`: Sets up a liquidity pool.
- `add_liquidity(provider, max_token, max_quote, min_shares)`: Deposits assets to earn fees.
- `swap(trader, input_token, amount_in, min_out)`: Swaps one token for another.
- `remove_liquidity(provider, shares, min_token, min_quote)`: Withdraws assets from the pool.

---

## Lending Pool
A decentralized lending and borrowing market where users can earn interest on deposits and borrow assets against collateral.

### Key Functions
- `deposit(user, asset, amount)`: Supplies collateral to the pool.
- `borrow(user, amount)`: Borrows SMT against collateral.
- `repay(user, amount)`: Returns borrowed tokens.
- `liquidate(liquidator, borrower, asset, amount)`: Liquidates risky debt.

---

## Dividend Distributor
Proportionally distributes XLM rewards to SoroMint token holders based on their balance at the time of deposit.

### Key Functions
- `deposit(depositor, amount, total_supply)`: Distributes XLM to all holders.
- `claim(holder, holder_balance)`: Withdraws accrued dividends for a specific holder.
- `claimable(holder, holder_balance)`: View-only function to check pending rewards.

---

## Streaming Payments
Facilitates real-time, ledger-by-ledger token streams for payroll or subscriptions.

### Key Functions
- `create_stream(sender, recipient, token, total, start, stop)`: Starts a continuous payment flow.
- `withdraw(stream_id, amount)`: Collects accumulated funds from a stream.
- `cancel_stream(stream_id)`: Stops a stream and refunds the remaining balance.

---

## Lottery
A VRF-based (Verifiable Random Function) lottery for token holders.

### Key Functions
- `commit_vrf(hash)`: Admin commits to a secret random value.
- `enter(participant)`: Holder buys a ticket.
- `reveal_vrf(secret)`: Admin reveals the secret, determining the winner and paying out the prize pool.

---

## Developer Guide
All contracts follow the standard Soroban SDK patterns. Documentation comments (`///`) are provided for every public function within the source code (`src/lib.rs` or `src/pool.rs`).

To build the documentation locally, use:
```bash
cargo doc --open
```
