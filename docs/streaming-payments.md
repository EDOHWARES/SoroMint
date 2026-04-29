# Streaming Payments Implementation

## Overview

The Streaming Payments Contract enables continuous, per-ledger token distribution for real-time payroll, subscriptions, and vesting schedules. This implementation provides a complete solution from smart contract to backend API integration.

## Architecture

```
┌─────────────────┐
│  Frontend (UI)  │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Backend API    │
│  (Express)      │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Soroban RPC    │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Streaming      │
│  Contract       │
└─────────────────┘
```

## Smart Contract

### Location
`contracts/streaming/`

### Key Features
- **Per-ledger streaming**: Calculates `rate_per_ledger = total_amount / duration`
- **Partial withdrawals**: Recipients withdraw available balance anytime
- **Cancellation with refunds**: Sender cancels and reclaims unstreamed tokens
- **Event emission**: Tracks creation, withdrawals, and cancellations

### Storage Model
```rust
Stream {
    sender: Address,
    recipient: Address,
    token: Address,
    rate_per_ledger: i128,
    start_ledger: u32,
    stop_ledger: u32,
    withdrawn: i128,
}
```

### Core Functions

#### `create_stream`
```rust
pub fn create_stream(
    e: Env,
    sender: Address,
    recipient: Address,
    token: Address,
    total_amount: i128,
    start_ledger: u32,
    stop_ledger: u32,
) -> u64
```
- Validates parameters
- Transfers tokens to contract
- Calculates rate per ledger
- Returns unique stream ID

#### `withdraw`
```rust
pub fn withdraw(e: Env, stream_id: u64, amount: i128)
```
- Requires recipient authorization
- Checks available balance
- Transfers tokens to recipient
- Updates withdrawn amount

#### `cancel_stream`
```rust
pub fn cancel_stream(e: Env, stream_id: u64)
```
- Requires sender authorization
- Transfers available balance to recipient
- Refunds unstreamed tokens to sender
- Removes stream from storage

#### `balance_of`
```rust
pub fn balance_of(e: Env, stream_id: u64) -> i128
```
- Calculates elapsed ledgers
- Returns `streamed - withdrawn`

## Backend Integration

### Service Layer
`server/services/streaming-service.js`

Handles Soroban RPC communication:
- Transaction building
- Contract invocation
- Result parsing
- Transaction polling

### API Routes
`server/routes/streaming-routes.js`

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/streams` | Create new stream |
| POST | `/streams/:id/withdraw` | Withdraw from stream |
| DELETE | `/streams/:id` | Cancel stream |
| GET | `/streams/:id` | Get stream details |
| GET | `/streams/:id/balance` | Get available balance |

### Database Model
`server/models/Stream.js`

Tracks stream metadata:
- Stream ID and contract address
- Sender and recipient addresses
- Token details and amounts
- Ledger range
- Status (active/completed/canceled)
- Transaction hashes

## Usage Examples

### 1. Monthly Salary Stream

```javascript
// Create 30-day salary stream
const currentLedger = await getCurrentLedger();
const monthInLedgers = 518_400; // ~30 days at 5s/ledger

const stream = await streamingService.createStream(
  contractId,
  employerKeypair,
  employerAddress,
  employeeAddress,
  usdcTokenAddress,
  '5000000000000', // 5000 USDC (7 decimals)
  currentLedger,
  currentLedger + monthInLedgers
);

// Employee withdraws weekly
const weekInLedgers = 120_960;
await streamingService.withdraw(
  contractId,
  employeeKeypair,
  stream.streamId,
  '1250000000000' // ~1250 USDC
);
```

### 2. Subscription Payment

```javascript
// Monthly subscription: 100 tokens
const subscription = await streamingService.createStream(
  contractId,
  subscriberKeypair,
  subscriberAddress,
  serviceProviderAddress,
  paymentTokenAddress,
  '1000000000', // 100 tokens
  currentLedger,
  currentLedger + 518_400
);

// Service provider withdraws daily
const dayInLedgers = 17_280;
const dailyAmount = '3333333'; // ~3.33 tokens/day

await streamingService.withdraw(
  contractId,
  providerKeypair,
  subscription.streamId,
  dailyAmount
);
```

### 3. Token Vesting

```javascript
// 1-year vesting with 3-month cliff
const yearInLedgers = 6_307_200;
const cliffInLedgers = 1_576_800;

const vesting = await streamingService.createStream(
  contractId,
  companyKeypair,
  companyAddress,
  founderAddress,
  companyTokenAddress,
  '1000000000000000', // 1M tokens
  currentLedger + cliffInLedgers,
  currentLedger + yearInLedgers
);
```

## Time Calculations

Stellar ledgers close approximately every 5 seconds:

| Duration | Ledgers | Calculation |
|----------|---------|-------------|
| 1 minute | 12 | 60 / 5 |
| 1 hour | 720 | 3600 / 5 |
| 1 day | 17,280 | 86400 / 5 |
| 1 week | 120,960 | 604800 / 5 |
| 30 days | 518,400 | 2592000 / 5 |
| 1 year | 6,307,200 | 31536000 / 5 |

## Environment Variables

Add to `server/.env`:

```env
STREAMING_CONTRACT_ID=C...
```

## Testing

### Contract Tests
```bash
cd contracts/streaming
cargo test
```

### Integration Tests
```bash
cd server
npm test -- streaming
```

## Deployment

### 1. Build Contract
```bash
cd contracts/streaming
cargo build --target wasm32-unknown-unknown --release
soroban contract optimize --wasm target/wasm32-unknown-unknown/release/soromint_streaming.wasm
```

### 2. Deploy to Testnet
```bash
soroban contract deploy \
  --wasm target/wasm32-unknown-unknown/release/soromint_streaming.wasm \
  --source DEPLOYER_SECRET \
  --rpc-url https://soroban-testnet.stellar.org:443 \
  --network-passphrase "Test SDF Network ; September 2015"
```

### 3. Update Backend Config
```bash
echo "STREAMING_CONTRACT_ID=<deployed_contract_id>" >> server/.env
```

### 4. Register Routes
Add to `server/index.js`:
```javascript
const streamingRoutes = require('./routes/streaming-routes');
app.use('/api/v1', streamingRoutes);
```

## Security Considerations

1. **Authorization**: All operations require proper signatures
2. **Balance Validation**: Prevents over-withdrawal
3. **Atomic Operations**: Token transfers are atomic with state updates
4. **Refund Safety**: Cancellation properly handles all balances
5. **Rate Limiting**: API endpoints should be rate-limited
6. **Input Validation**: All inputs validated before contract calls

## Gas Optimization

- Uses persistent storage for streams (cheaper than instance)
- Minimal storage keys (stream ID only)
- Efficient balance calculation (no iteration)
- Events for off-chain indexing

## Monitoring

Track these metrics:
- Active streams count
- Total value locked
- Withdrawal frequency
- Cancellation rate
- Failed transactions

## Future Enhancements

1. **Pause/Resume**: Temporarily halt streaming
2. **Multi-recipient**: Split stream to multiple addresses
3. **Dynamic Rate**: Adjust rate during stream
4. **Cliff Period**: Delay before streaming starts
5. **Batch Operations**: Create/cancel multiple streams
6. **NFT Integration**: Stream NFT royalties

## Support

For issues or questions:
- GitHub: EDOHWARES/SoroMint
- Issue: #188 Streaming Payments Contract

## License

Part of the SoroMint project.
