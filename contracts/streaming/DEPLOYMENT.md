# Streaming Payments Contract - Deployment Guide

## Prerequisites

1. Install Rust and Cargo
2. Install Soroban CLI
3. Add WASM target

```bash
rustup target add wasm32-unknown-unknown
```

## Build Steps

### 1. Build the Contract

```bash
cd contracts/streaming
cargo build --target wasm32-unknown-unknown --release
```

The compiled WASM will be at:
```
target/wasm32-unknown-unknown/release/soromint_streaming.wasm
```

### 2. Optimize (Optional but Recommended)

```bash
soroban contract optimize \
  --wasm target/wasm32-unknown-unknown/release/soromint_streaming.wasm
```

This creates an optimized version:
```
target/wasm32-unknown-unknown/release/soromint_streaming.optimized.wasm
```

## Deployment

### Testnet Deployment

```bash
soroban contract deploy \
  --wasm target/wasm32-unknown-unknown/release/soromint_streaming.wasm \
  --source DEPLOYER_SECRET_KEY \
  --rpc-url https://soroban-testnet.stellar.org:443 \
  --network-passphrase "Test SDF Network ; September 2015"
```

Save the returned contract ID.

### Futurenet Deployment

```bash
soroban contract deploy \
  --wasm target/wasm32-unknown-unknown/release/soromint_streaming.wasm \
  --source DEPLOYER_SECRET_KEY \
  --rpc-url https://rpc-futurenet.stellar.org:443 \
  --network-passphrase "Test SDF Future Network ; October 2022"
```

## Backend Configuration

Add the deployed contract ID to your `.env` file:

```env
STREAMING_CONTRACT_ID=C...
```

## Testing the Deployment

### 1. Create a Test Stream

```bash
soroban contract invoke \
  --id <CONTRACT_ID> \
  --source <SENDER_SECRET> \
  --rpc-url https://soroban-testnet.stellar.org:443 \
  --network-passphrase "Test SDF Network ; September 2015" \
  -- \
  create_stream \
  --sender <SENDER_ADDRESS> \
  --recipient <RECIPIENT_ADDRESS> \
  --token <TOKEN_CONTRACT_ID> \
  --total_amount 1000000000 \
  --start_ledger <CURRENT_LEDGER> \
  --stop_ledger <CURRENT_LEDGER + 1000>
```

### 2. Check Stream Balance

```bash
soroban contract invoke \
  --id <CONTRACT_ID> \
  --source <ANY_ADDRESS> \
  --rpc-url https://soroban-testnet.stellar.org:443 \
  --network-passphrase "Test SDF Network ; September 2015" \
  -- \
  balance_of \
  --stream_id 0
```

### 3. Withdraw from Stream

```bash
soroban contract invoke \
  --id <CONTRACT_ID> \
  --source <RECIPIENT_SECRET> \
  --rpc-url https://soroban-testnet.stellar.org:443 \
  --network-passphrase "Test SDF Network ; September 2015" \
  -- \
  withdraw \
  --stream_id 0 \
  --amount 500000000
```

## Integration with Backend

### 1. Update server/index.js

Add the streaming routes:

```javascript
const streamingRoutes = require('./routes/streaming-routes');
app.use('/api/v1', streamingRoutes);
```

### 2. Install Dependencies

The backend service uses `@stellar/stellar-sdk` and `express-validator`:

```bash
cd server
npm install @stellar/stellar-sdk express-validator
```

### 3. Test API Endpoints

```bash
# Create stream
curl -X POST http://localhost:3000/api/v1/streams \
  -H "Content-Type: application/json" \
  -d '{
    "sender": "G...",
    "recipient": "G...",
    "tokenAddress": "C...",
    "totalAmount": "1000000000",
    "startLedger": 12345,
    "stopLedger": 13345
  }'

# Get stream details
curl http://localhost:3000/api/v1/streams/0

# Get stream balance
curl http://localhost:3000/api/v1/streams/0/balance

# Withdraw
curl -X POST http://localhost:3000/api/v1/streams/0/withdraw \
  -H "Content-Type: application/json" \
  -d '{"amount": "500000000"}'

# Cancel stream
curl -X DELETE http://localhost:3000/api/v1/streams/0
```

## Monitoring

### Watch Contract Events

```bash
soroban events \
  --id <CONTRACT_ID> \
  --start-ledger <START> \
  --rpc-url https://soroban-testnet.stellar.org:443 \
  --network-passphrase "Test SDF Network ; September 2015"
```

Events emitted:
- `created`: When a stream is created
- `withdraw`: When funds are withdrawn
- `canceled`: When a stream is canceled

## Troubleshooting

### Build Errors

If you get "can't find crate for `core`":
```bash
rustup target add wasm32-unknown-unknown
```

### Deployment Errors

If deployment fails with "insufficient balance":
- Fund your deployer account with XLM
- Testnet faucet: https://laboratory.stellar.org/#account-creator

### Transaction Errors

If transactions fail:
- Check account has sufficient XLM for fees
- Verify contract ID is correct
- Ensure token contract allows transfers
- Check ledger numbers are valid (start < stop)

## Production Checklist

- [ ] Contract audited for security
- [ ] Tests passing with 100% coverage
- [ ] WASM optimized for size
- [ ] Deployed to testnet and verified
- [ ] Backend integration tested
- [ ] Rate limiting configured
- [ ] Monitoring and alerts set up
- [ ] Documentation updated
- [ ] Emergency pause mechanism tested
- [ ] Backup and recovery plan in place

## Gas Costs (Approximate)

| Operation | CPU Instructions | Storage Bytes | Estimated Cost |
|-----------|------------------|---------------|----------------|
| create_stream | ~500k | 200 | ~0.01 XLM |
| withdraw | ~300k | 100 | ~0.005 XLM |
| cancel_stream | ~400k | -200 | ~0.007 XLM |
| balance_of | ~100k | 0 | ~0.001 XLM |

*Costs vary based on network congestion and ledger state*

## Support

For issues or questions:
- GitHub: EDOHWARES/SoroMint
- Issue: #188 Streaming Payments Contract
- Docs: `/docs/streaming-payments.md`
