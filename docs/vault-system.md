# Multi-Collateral Vault System

## Overview

The SoroMint Vault System enables users to deposit multiple different tokens as collateral to mint a stable SMT (SoroMint Token) asset pegged to $1 USD. This is a decentralized lending protocol similar to MakerDAO's Multi-Collateral DAI system.

## Architecture

### Core Components

1. **Vault Contract** (`contracts/vault/src/lib.rs`)
   - Manages collateral deposits and SMT minting
   - Tracks individual vault positions
   - Handles liquidations
   - Enforces collateralization ratios

2. **Oracle Contract** (`contracts/oracle/src/lib.rs`)
   - Provides price feeds for collateral tokens
   - Updates prices from trusted sources
   - Supports batch price queries

3. **SMT Token** (Stable SoroMint Token)
   - ERC-20 compatible stable token
   - Pegged to $1 USD
   - Minted/burned by vault contract

## Key Concepts

### Collateralization Ratio

The ratio of collateral value to debt value:
```
Collateralization Ratio = (Collateral Value / Debt Value) × 100%
```

- **Minimum Ratio**: 150% (configurable per collateral)
- **Liquidation Threshold**: 130% (when vault becomes liquidatable)
- **Liquidation Penalty**: 10% (bonus for liquidators)

### Vault Position

Each vault contains:
- **Owner**: Address that controls the vault
- **Collaterals**: Map of token addresses to amounts
- **Debt**: Amount of SMT minted
- **Created At**: Timestamp of vault creation

### Collateral Configuration

Each supported collateral has:
- **Enabled**: Whether deposits are allowed
- **Min Collateral Ratio**: Minimum ratio required
- **Liquidation Threshold**: Ratio below which liquidation is allowed
- **Liquidation Penalty**: Bonus percentage for liquidators

## User Workflows

### 1. Create Vault and Mint SMT

```rust
// Deposit 100 USDC as collateral and mint 60 SMT
vault.deposit_and_mint(
    user,
    usdc_token,
    100_0000000,  // 100 USDC (7 decimals)
    60_0000000,   // 60 SMT (7 decimals)
)
// Returns vault_id
```

**Requirements**:
- Collateral must be supported
- Collateralization ratio ≥ minimum (e.g., 150%)
- User must approve token transfer

**Result**:
- Collateral transferred to vault
- SMT minted to user
- Vault position created

### 2. Add More Collateral

```rust
// Add 50 more USDC to existing vault
vault.add_collateral(
    vault_id,
    usdc_token,
    50_0000000,
)
```

**Effect**: Increases collateralization ratio, reduces liquidation risk

### 3. Mint Additional SMT

```rust
// Mint 20 more SMT against existing collateral
vault.mint_more(
    vault_id,
    20_0000000,
)
```

**Requirements**:
- Vault must remain above minimum collateralization ratio
- Increases debt

### 4. Repay Debt and Withdraw Collateral

```rust
// Repay 30 SMT and withdraw 40 USDC
vault.repay_and_withdraw(
    vault_id,
    30_0000000,  // Repay amount
    usdc_token,
    40_0000000,  // Withdraw amount
)
```

**Requirements**:
- User must have SMT to burn
- Vault must remain healthy if debt > 0
- Cannot withdraw more than deposited

### 5. Liquidation

```rust
// Liquidate undercollateralized vault
vault.liquidate(
    vault_id,
    liquidator,
    50_0000000,  // Debt to cover
)
```

**Requirements**:
- Vault collateralization ratio < liquidation threshold
- Liquidator must have SMT to burn

**Result**:
- SMT burned from liquidator
- Collateral seized and transferred to liquidator
- Liquidator receives bonus (e.g., 10%)

## Multi-Collateral Support

### Supported Collateral Types

Users can deposit multiple different tokens in a single vault:

```rust
// Vault with mixed collateral
Vault {
    owner: user_address,
    collaterals: {
        USDC: 100_0000000,
        XLM: 500_0000000,
        BTC: 0_0050000,
    },
    debt: 200_0000000,  // 200 SMT
}
```

### Collateral Valuation

Total collateral value calculated using oracle prices:

```
Total Value = Σ (amount_i × price_i)
```

Example:
- 100 USDC @ $1.00 = $100
- 500 XLM @ $0.12 = $60
- 0.005 BTC @ $40,000 = $200
- **Total**: $360

With 200 SMT debt:
- Collateralization Ratio = ($360 / $200) × 100% = 180%

## Liquidation Mechanism

### When Liquidation Occurs

A vault becomes liquidatable when:
```
Collateralization Ratio < Liquidation Threshold (130%)
```

### Liquidation Process

1. **Liquidator calls `liquidate()`** with debt amount to cover
2. **Vault health checked** - must be below threshold
3. **SMT burned** from liquidator
4. **Collateral seized** proportionally from all collateral types
5. **Liquidation bonus applied** (e.g., 10% extra collateral)
6. **Collateral transferred** to liquidator
7. **Vault debt reduced** by covered amount

### Liquidation Example

Vault state:
- Collateral: 100 USDC ($100)
- Debt: 80 SMT ($80)
- Ratio: 125% (below 130% threshold)

Liquidator covers 40 SMT:
- Burns: 40 SMT
- Receives: $44 worth of USDC (40 + 10% bonus)
- Vault remaining: 56 USDC collateral, 40 SMT debt

### Partial Liquidation

Liquidators can liquidate portions of a vault:
- Reduces risk for liquidator
- Allows vault to recover
- Multiple liquidators can participate

## Oracle Integration

### Price Feed Requirements

- **Accuracy**: Prices must reflect real market values
- **Freshness**: Regular updates required
- **Reliability**: Trusted price sources

### Price Format

All prices use 7 decimals:
- $1.00 = 1_0000000
- $0.12 = 0_1200000
- $40,000 = 40000_0000000

### Setting Prices

```rust
oracle.set_price(
    usdc_token,
    1_0000000,  // $1.00
    price_feed_source,
)
```

### Querying Prices

```rust
// Single price
let price = oracle.get_price(token);

// Batch prices
let prices = oracle.get_prices(vec![token1, token2, token3]);
```

## Security Considerations

### Collateralization Requirements

- **Over-collateralization**: Required to absorb price volatility
- **Liquidation Buffer**: Gap between min ratio and liquidation threshold
- **Per-Token Limits**: Different ratios for different risk profiles

### Oracle Security

- **Admin-only updates**: Only authorized addresses can set prices
- **Timestamp tracking**: Detect stale prices
- **Multiple sources**: Consider aggregating multiple price feeds

### Liquidation Incentives

- **Penalty rewards liquidators**: Encourages timely liquidations
- **Partial liquidations**: Reduces systemic risk
- **Gas efficiency**: Liquidation must be profitable after gas costs

### Attack Vectors

1. **Price Manipulation**: Mitigated by trusted oracle
2. **Flash Loan Attacks**: Prevented by collateral lock-in
3. **Liquidation Front-running**: Inherent to blockchain
4. **Oracle Failure**: System pauses if prices unavailable

## Smart Contract Functions

### Admin Functions

- `initialize(admin, smt_token, oracle)` - Set up vault system
- `add_collateral(token, min_ratio, liq_threshold, penalty)` - Add supported collateral

### User Functions

- `deposit_and_mint(user, token, collateral, smt)` - Create vault
- `add_collateral(vault_id, token, amount)` - Add collateral
- `mint_more(vault_id, amount)` - Mint additional SMT
- `repay_and_withdraw(vault_id, repay, token, withdraw)` - Repay and withdraw

### Liquidation Functions

- `liquidate(vault_id, liquidator, debt_to_cover)` - Liquidate vault
- `is_liquidatable(vault_id)` - Check if vault can be liquidated

### Query Functions

- `get_vault(vault_id)` - Get vault details
- `get_user_vaults(user)` - Get user's vault IDs
- `get_vault_health(vault_id)` - Get collateralization ratio

## Economic Parameters

### Default Configuration

```rust
MIN_COLLATERAL_RATIO = 15000  // 150%
LIQUIDATION_THRESHOLD = 13000  // 130%
LIQUIDATION_PENALTY = 1000     // 10%
BP_DIVISOR = 10000             // Basis points
```

### Per-Collateral Configuration

Example configurations:

**Stablecoins (USDC, USDT)**:
- Min Ratio: 110%
- Liquidation: 105%
- Penalty: 5%

**Major Crypto (BTC, ETH)**:
- Min Ratio: 150%
- Liquidation: 130%
- Penalty: 10%

**Volatile Assets (ALT coins)**:
- Min Ratio: 200%
- Liquidation: 170%
- Penalty: 15%

## Testing

### Unit Tests

```bash
cd contracts/vault
cargo test
```

### Integration Tests

Test scenarios:
- Vault creation with various collateral ratios
- Multi-collateral deposits
- Liquidation at different health levels
- Oracle price updates
- Edge cases (zero debt, max collateral, etc.)

## Deployment

### 1. Deploy Oracle Contract

```bash
cd contracts/oracle
cargo build --target wasm32-unknown-unknown --release
soroban contract deploy --wasm target/wasm32-unknown-unknown/release/soromint_oracle.wasm
```

### 2. Deploy Vault Contract

```bash
cd contracts/vault
cargo build --target wasm32-unknown-unknown --release
soroban contract deploy --wasm target/wasm32-unknown-unknown/release/soromint_vault.wasm
```

### 3. Initialize Contracts

```bash
# Initialize oracle
soroban contract invoke --id <ORACLE_ID> -- initialize --admin <ADMIN>

# Initialize vault
soroban contract invoke --id <VAULT_ID> -- initialize \
  --admin <ADMIN> \
  --smt-token <SMT_TOKEN> \
  --oracle <ORACLE_ID>
```

### 4. Configure Collateral

```bash
soroban contract invoke --id <VAULT_ID> -- add_collateral \
  --collateral-token <USDC> \
  --min-collateral-ratio 15000 \
  --liquidation-threshold 13000 \
  --liquidation-penalty 1000
```

## Future Enhancements

1. **Stability Fee**: Charge interest on debt
2. **Debt Ceiling**: Limit total SMT minted per collateral
3. **Emergency Shutdown**: Pause system in crisis
4. **Governance**: Decentralized parameter updates
5. **Liquidation Auctions**: Dutch auction for better price discovery
6. **Flash Minting**: Borrow SMT within single transaction
7. **Collateral Swaps**: Exchange one collateral for another
8. **Vault Insurance**: Optional insurance against liquidation

## Monitoring

### Key Metrics

- Total Value Locked (TVL)
- Total SMT Supply
- Average Collateralization Ratio
- Number of Active Vaults
- Liquidation Volume
- Oracle Price Deviations

### Health Indicators

- Vaults near liquidation threshold
- Oracle price staleness
- System collateralization ratio
- Liquidation success rate

## Risk Management

### User Risks

- **Liquidation Risk**: Maintain healthy collateralization
- **Oracle Risk**: Prices may not reflect true market
- **Smart Contract Risk**: Bugs or exploits
- **Peg Risk**: SMT may deviate from $1

### Mitigation Strategies

- Monitor vault health regularly
- Maintain buffer above liquidation threshold
- Diversify collateral types
- Use price alerts
- Understand liquidation mechanics
