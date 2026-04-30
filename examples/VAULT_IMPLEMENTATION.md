# Multi-Collateral Vault System Implementation

## Overview
Implemented a comprehensive multi-collateral vault system that allows users to deposit multiple different tokens as collateral to mint stable SMT (SoroMint Token) assets pegged to $1 USD.

## Components Implemented

### 1. Smart Contracts

#### Vault Contract (`contracts/vault/src/lib.rs`)
Core vault management contract with:
- **Multi-collateral support**: Accept multiple token types in single vault
- **Collateralization management**: Enforce minimum ratios per collateral type
- **Minting/burning**: Create and destroy SMT based on collateral
- **Liquidation mechanism**: Automated liquidation of undercollateralized vaults
- **Health monitoring**: Real-time collateralization ratio tracking

**Key Functions**:
- `initialize()` - Set up vault system with admin, SMT token, oracle
- `add_collateral()` - Configure supported collateral tokens
- `deposit_and_mint()` - Create vault with collateral and mint SMT
- `add_collateral()` - Add more collateral to existing vault
- `mint_more()` - Mint additional SMT against existing collateral
- `repay_and_withdraw()` - Repay debt and withdraw collateral
- `liquidate()` - Liquidate undercollateralized vaults
- `get_vault()` - Query vault details
- `get_vault_health()` - Get collateralization ratio
- `is_liquidatable()` - Check if vault can be liquidated

#### Oracle Contract (`contracts/oracle/src/lib.rs`)
Price feed oracle for collateral valuation:
- **Price management**: Admin-controlled price updates
- **Multi-token support**: Track prices for multiple assets
- **Batch queries**: Get multiple prices efficiently
- **Timestamp tracking**: Monitor price freshness

**Key Functions**:
- `initialize()` - Set up oracle with admin
- `set_price()` - Update token price (admin only)
- `get_price()` - Query single token price
- `get_prices()` - Batch query multiple prices
- `has_price()` - Check if price exists

### 2. Supporting Modules

#### Storage (`contracts/vault/src/storage.rs`)
Data structures:
- `VaultPosition` - Individual vault state
- `CollateralConfig` - Per-token configuration
- `DataKey` - Storage key enumeration

#### Oracle Integration (`contracts/vault/src/oracle.rs`)
Helper functions for price queries:
- `get_price()` - Single price query
- `get_prices()` - Batch price query
- `has_price()` - Price availability check

#### Liquidation Logic (`contracts/vault/src/liquidation.rs`)
Liquidation calculations:
- `calculate_liquidation_bonus()` - Liquidator reward calculation
- `should_liquidate()` - Liquidation eligibility check
- `calculate_total_collateral_value()` - Total value across tokens
- `calculate_collateral_to_seize()` - Seizure amount calculation
- `distribute_seized_collateral()` - Proportional distribution

#### Events (`contracts/vault/src/events.rs`)
Event emissions for:
- Vault initialization
- Collateral addition
- Vault creation
- SMT minting
- Repayment and withdrawal
- Liquidations

### 3. Backend Layer

#### Vault Model (`server/models/Vault.js`)
MongoDB schema tracking:
- Vault ID and contract address
- Owner address
- Collateral positions (multi-token)
- Debt amount
- Collateralization ratio
- Status (active/liquidated/closed)
- Liquidation history

**Methods**:
- `isHealthy()` - Check if above liquidation threshold
- `isLiquidatable()` - Check if eligible for liquidation

#### Vault Service (`server/services/vault-service.js`)
Business logic for:
- `createVault()` - Create new vault position
- `addCollateral()` - Add collateral to vault
- `mintMore()` - Mint additional SMT
- `repayAndWithdraw()` - Repay debt and withdraw
- `liquidate()` - Execute liquidation
- `getVault()` - Query vault details
- `getVaultHealth()` - Get health ratio
- `getUserVaults()` - List user's vaults
- `getLiquidatableVaults()` - Find liquidatable vaults

#### API Routes (`server/routes/vault-routes.js`)
REST endpoints:
- `POST /api/vault/create` - Create vault
- `POST /api/vault/:vaultId/add-collateral` - Add collateral
- `POST /api/vault/:vaultId/mint` - Mint more SMT
- `POST /api/vault/:vaultId/repay` - Repay and withdraw
- `POST /api/vault/:vaultId/liquidate` - Liquidate vault
- `GET /api/vault/:vaultId` - Get vault details
- `GET /api/vault/:vaultId/health` - Get health ratio
- `GET /api/vault/user/:userAddress` - Get user vaults
- `GET /api/vault/liquidatable/list` - List liquidatable vaults

### 4. Documentation

#### Comprehensive Guide (`docs/vault-system.md`)
Complete documentation covering:
- Architecture overview
- Key concepts (collateralization, liquidation)
- User workflows with code examples
- Multi-collateral support details
- Liquidation mechanism
- Oracle integration
- Security considerations
- Economic parameters
- Testing and deployment
- Future enhancements
- Risk management

## Key Features

### Multi-Collateral Support
- Single vault can hold multiple token types
- Each collateral type has independent configuration
- Proportional liquidation across all collaterals
- Aggregate collateralization ratio calculation

### Flexible Collateralization
- Per-token minimum collateral ratios
- Per-token liquidation thresholds
- Per-token liquidation penalties
- Dynamic configuration by admin

### Liquidation System
- Automated liquidation when ratio drops below threshold
- Liquidator incentives (10% default bonus)
- Partial liquidation support
- Proportional collateral seizure

### Oracle Integration
- External price feed support
- Batch price queries for efficiency
- Price staleness detection
- Admin-controlled updates

### Safety Mechanisms
- Over-collateralization requirements (150% default)
- Liquidation buffer (20% default gap)
- Authorization checks on all operations
- Safe math for all calculations

## Economic Parameters

### Default Configuration
```rust
MIN_COLLATERAL_RATIO = 15000  // 150%
LIQUIDATION_THRESHOLD = 13000  // 130%
LIQUIDATION_PENALTY = 1000     // 10%
BP_DIVISOR = 10000             // Basis points
```

### Per-Collateral Customization
Different risk profiles supported:
- **Stablecoins**: Lower ratios (110% min, 105% liquidation)
- **Major crypto**: Medium ratios (150% min, 130% liquidation)
- **Volatile assets**: Higher ratios (200% min, 170% liquidation)

## Workflows

### 1. Create Vault
```javascript
POST /api/vault/create
{
  vaultContractId: "C...",
  collateralToken: "C...",
  collateralAmount: "100_0000000",
  smtAmount: "60_0000000"
}
```

### 2. Add Collateral
```javascript
POST /api/vault/:vaultId/add-collateral
{
  vaultContractId: "C...",
  collateralToken: "C...",
  amount: "50_0000000"
}
```

### 3. Mint More SMT
```javascript
POST /api/vault/:vaultId/mint
{
  vaultContractId: "C...",
  smtAmount: "20_0000000"
}
```

### 4. Repay and Withdraw
```javascript
POST /api/vault/:vaultId/repay
{
  vaultContractId: "C...",
  repayAmount: "30_0000000",
  collateralToken: "C...",
  withdrawAmount: "40_0000000"
}
```

### 5. Liquidate
```javascript
POST /api/vault/:vaultId/liquidate
{
  vaultContractId: "C...",
  debtToCover: "50_0000000"
}
```

## Security Features

### On-Chain Security
- Authorization checks on all state-changing operations
- Safe arithmetic to prevent overflows
- Collateralization ratio enforcement
- Liquidation threshold validation
- Admin-only configuration changes

### Off-Chain Security
- JWT authentication for all endpoints
- Input validation and sanitization
- Rate limiting on critical operations
- Audit logging for all transactions
- Error handling and recovery

### Economic Security
- Over-collateralization requirements
- Liquidation incentives for timely action
- Partial liquidation to reduce systemic risk
- Oracle price validation

## Testing

### Contract Tests (`contracts/vault/src/test.rs`)
- Initialization tests
- Vault creation with various ratios
- Multi-collateral deposits
- Liquidation scenarios
- Health calculation
- Edge cases

### Integration Tests
Test scenarios:
- End-to-end vault lifecycle
- Multi-collateral management
- Liquidation execution
- Oracle price updates
- Error conditions

## Deployment

### 1. Build Contracts
```bash
cd contracts/oracle
cargo build --target wasm32-unknown-unknown --release

cd ../vault
cargo build --target wasm32-unknown-unknown --release
```

### 2. Deploy Contracts
```bash
soroban contract deploy --wasm oracle.wasm
soroban contract deploy --wasm vault.wasm
```

### 3. Initialize
```bash
soroban contract invoke --id <ORACLE> -- initialize --admin <ADMIN>
soroban contract invoke --id <VAULT> -- initialize \
  --admin <ADMIN> --smt-token <SMT> --oracle <ORACLE>
```

### 4. Configure Collateral
```bash
soroban contract invoke --id <VAULT> -- add_collateral \
  --collateral-token <TOKEN> \
  --min-collateral-ratio 15000 \
  --liquidation-threshold 13000 \
  --liquidation-penalty 1000
```

## Files Created

### Contracts
- `contracts/vault/src/lib.rs` - Main vault contract
- `contracts/vault/src/storage.rs` - Data structures
- `contracts/vault/src/oracle.rs` - Oracle integration
- `contracts/vault/src/liquidation.rs` - Liquidation logic
- `contracts/vault/src/events.rs` - Event emissions
- `contracts/vault/src/test.rs` - Contract tests
- `contracts/vault/Cargo.toml` - Contract manifest
- `contracts/oracle/src/lib.rs` - Oracle contract
- `contracts/oracle/Cargo.toml` - Oracle manifest

### Backend
- `server/models/Vault.js` - Vault data model
- `server/services/vault-service.js` - Business logic
- `server/routes/vault-routes.js` - API endpoints

### Documentation
- `docs/vault-system.md` - Comprehensive guide

## Complexity Assessment

**Area**: Contracts
**Complexity**: Very High ✓

### Justification
- Multi-contract system (vault + oracle)
- Complex collateral management across multiple tokens
- Sophisticated liquidation mechanism
- Price oracle integration
- Economic parameter management
- Proportional calculations
- State management across multiple data structures
- Security-critical financial operations

## Future Enhancements

1. **Stability Fee**: Interest on debt positions
2. **Debt Ceiling**: Per-collateral minting limits
3. **Emergency Shutdown**: System pause mechanism
4. **Governance**: Decentralized parameter updates
5. **Liquidation Auctions**: Dutch auction for better discovery
6. **Flash Minting**: Single-transaction borrowing
7. **Collateral Swaps**: Exchange collateral types
8. **Vault Insurance**: Optional liquidation protection

## Monitoring

### Key Metrics
- Total Value Locked (TVL)
- Total SMT Supply
- Average Collateralization Ratio
- Active Vaults Count
- Liquidation Volume
- Oracle Price Deviations

### Health Indicators
- Vaults near liquidation
- Oracle staleness
- System collateralization
- Liquidation success rate
