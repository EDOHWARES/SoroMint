# Streaming Payments - Quick Reference

## Contract Functions

### create_stream
```rust
create_stream(
    sender: Address,
    recipient: Address,
    token: Address,
    total_amount: i128,
    start_ledger: u32,
    stop_ledger: u32
) -> u64
```
**Auth**: sender  
**Returns**: stream_id

### withdraw
```rust
withdraw(stream_id: u64, amount: i128)
```
**Auth**: recipient

### cancel_stream
```rust
cancel_stream(stream_id: u64)
```
**Auth**: sender

### balance_of
```rust
balance_of(stream_id: u64) -> i128
```
**Auth**: none

### get_stream
```rust
get_stream(stream_id: u64) -> Stream
```
**Auth**: none

---

## API Endpoints

| Method | Endpoint | Body | Response |
|--------|----------|------|----------|
| POST | `/api/v1/streams` | `{sender, recipient, tokenAddress, totalAmount, startLedger, stopLedger}` | `{streamId, txHash}` |
| POST | `/api/v1/streams/:id/withdraw` | `{amount}` | `{txHash}` |
| DELETE | `/api/v1/streams/:id` | - | `{txHash}` |
| GET | `/api/v1/streams/:id` | - | `{stream}` |
| GET | `/api/v1/streams/:id/balance` | - | `{balance}` |

---

## Time Conversions

| Duration | Ledgers | Formula |
|----------|---------|---------|
| 1 minute | 12 | 60 / 5 |
| 1 hour | 720 | 3600 / 5 |
| 1 day | 17,280 | 86,400 / 5 |
| 1 week | 120,960 | 604,800 / 5 |
| 30 days | 518,400 | 2,592,000 / 5 |
| 1 year | 6,307,200 | 31,536,000 / 5 |

*Assumes 5 seconds per ledger*

---

## Common Patterns

### Monthly Salary
```javascript
const monthlyStream = await client.create_stream(
    employer, employee, usdc,
    5000_0000000, // 5000 USDC
    currentLedger,
    currentLedger + 518_400
);
```

### Weekly Withdrawal
```javascript
const weeklyAmount = totalAmount / 4;
await client.withdraw(streamId, weeklyAmount);
```

### Early Termination
```javascript
await client.cancel_stream(streamId);
// Recipient gets streamed amount
// Sender gets refund of unstreamed
```

---

## Events

### created
```
topics: ["created", stream_id]
data: (sender, recipient, total_amount)
```

### withdraw
```
topics: ["withdraw", stream_id]
data: (recipient, amount)
```

### canceled
```
topics: ["canceled", stream_id]
data: (recipient_balance, refund_amount)
```

---

## Error Messages

| Error | Cause | Solution |
|-------|-------|----------|
| `amount must be positive` | total_amount ≤ 0 | Use positive amount |
| `invalid ledger range` | stop ≤ start | Ensure stop > start |
| `amount too small for duration` | rate_per_ledger = 0 | Increase amount or reduce duration |
| `stream not found` | Invalid stream_id | Check stream exists |
| `insufficient balance` | Withdrawal > available | Check balance_of first |

---

## Build Commands

```bash
# Test
cargo test

# Build
cargo build --target wasm32-unknown-unknown --release

# Optimize
soroban contract optimize --wasm target/wasm32-unknown-unknown/release/soromint_streaming.wasm

# Deploy
soroban contract deploy \
  --wasm target/wasm32-unknown-unknown/release/soromint_streaming.wasm \
  --source SECRET \
  --rpc-url https://soroban-testnet.stellar.org:443 \
  --network-passphrase "Test SDF Network ; September 2015"
```

---

## Environment Variables

```env
STREAMING_CONTRACT_ID=C...
SOROBAN_RPC_URL=https://soroban-testnet.stellar.org:443
NETWORK_PASSPHRASE=Test SDF Network ; September 2015
```

---

## Gas Estimates

| Operation | Cost (XLM) |
|-----------|------------|
| create_stream | ~0.01 |
| withdraw | ~0.005 |
| cancel_stream | ~0.007 |
| balance_of | ~0.001 |

---

## Security Notes

✅ Always validate ledger numbers  
✅ Check token allowances before creating streams  
✅ Monitor for failed transactions  
✅ Implement rate limiting on API  
✅ Use HTTPS for all API calls  
✅ Store secrets securely (never in code)

---

## Support

📖 Full Docs: `/docs/streaming-payments.md`  
🚀 Deployment: `/contracts/streaming/DEPLOYMENT.md`  
🐛 Issues: GitHub #188
