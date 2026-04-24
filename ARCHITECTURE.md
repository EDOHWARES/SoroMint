# Streaming Payments Architecture Diagram

## System Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                         USER INTERFACE                          │
│                    (Frontend / API Client)                      │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             │ HTTP/REST
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                      BACKEND API SERVER                         │
│                      (Express.js / Node)                        │
│                                                                 │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │              API Routes Layer                            │  │
│  │  /api/v1/streams (streaming-routes.js)                  │  │
│  │  - POST   /streams              Create stream           │  │
│  │  - POST   /streams/:id/withdraw Withdraw funds          │  │
│  │  - DELETE /streams/:id          Cancel stream           │  │
│  │  - GET    /streams/:id          Get details             │  │
│  │  - GET    /streams/:id/balance  Check balance           │  │
│  └──────────────────────────────────────────────────────────┘  │
│                             │                                   │
│                             ▼                                   │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │           Service Layer                                  │  │
│  │  streaming-service.js                                    │  │
│  │  - Transaction building                                  │  │
│  │  - Contract invocation                                   │  │
│  │  - Result parsing                                        │  │
│  │  - Transaction polling                                   │  │
│  └──────────────────────────────────────────────────────────┘  │
│                             │                                   │
│                             ▼                                   │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │           Database Layer                                 │  │
│  │  Stream.js (MongoDB Model)                               │  │
│  │  - Stream metadata                                       │  │
│  │  - Status tracking                                       │  │
│  │  - Transaction history                                   │  │
│  └──────────────────────────────────────────────────────────┘  │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             │ Soroban RPC
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                      SOROBAN RPC SERVER                         │
│                   (Stellar Network Node)                        │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             │ Contract Calls
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                  STREAMING PAYMENTS CONTRACT                    │
│                      (Soroban Smart Contract)                   │
│                                                                 │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │                  Contract Functions                      │  │
│  │                                                          │  │
│  │  create_stream(sender, recipient, token, amount, ...)   │  │
│  │  ├─ Validate parameters                                 │  │
│  │  ├─ Calculate rate_per_ledger                           │  │
│  │  ├─ Transfer tokens to contract                         │  │
│  │  ├─ Store stream data                                   │  │
│  │  └─ Emit "created" event                                │  │
│  │                                                          │  │
│  │  withdraw(stream_id, amount)                            │  │
│  │  ├─ Verify recipient authorization                      │  │
│  │  ├─ Calculate available balance                         │  │
│  │  ├─ Transfer tokens to recipient                        │  │
│  │  ├─ Update withdrawn amount                             │  │
│  │  └─ Emit "withdraw" event                               │  │
│  │                                                          │  │
│  │  cancel_stream(stream_id)                               │  │
│  │  ├─ Verify sender authorization                         │  │
│  │  ├─ Calculate recipient balance                         │  │
│  │  ├─ Transfer balance to recipient                       │  │
│  │  ├─ Calculate and refund unstreamed                     │  │
│  │  ├─ Remove stream from storage                          │  │
│  │  └─ Emit "canceled" event                               │  │
│  │                                                          │  │
│  │  balance_of(stream_id) -> i128                          │  │
│  │  ├─ Get stream data                                     │  │
│  │  ├─ Calculate elapsed ledgers                           │  │
│  │  ├─ Calculate streamed amount                           │  │
│  │  └─ Return (streamed - withdrawn)                       │  │
│  │                                                          │  │
│  │  get_stream(stream_id) -> Stream                        │  │
│  │  └─ Return stream data from storage                     │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                 │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │                  Storage Layer                           │  │
│  │                                                          │  │
│  │  DataKey::Stream(stream_id) -> Stream {                 │  │
│  │    sender: Address,                                     │  │
│  │    recipient: Address,                                  │  │
│  │    token: Address,                                      │  │
│  │    rate_per_ledger: i128,                               │  │
│  │    start_ledger: u32,                                   │  │
│  │    stop_ledger: u32,                                    │  │
│  │    withdrawn: i128                                      │  │
│  │  }                                                       │  │
│  │                                                          │  │
│  │  DataKey::NextStreamId -> u64                           │  │
│  └──────────────────────────────────────────────────────────┘  │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             │ Token Transfers
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                      TOKEN CONTRACT                             │
│                   (Soroban Token / SAC)                         │
│                                                                 │
│  - Holds streamed tokens                                        │
│  - Transfers on create_stream                                   │
│  - Transfers on withdraw                                        │
│  - Transfers on cancel_stream                                   │
└─────────────────────────────────────────────────────────────────┘
```

## Data Flow Diagrams

### 1. Create Stream Flow

```
User/Sender
    │
    │ 1. POST /api/v1/streams
    │    {sender, recipient, token, amount, start, stop}
    ▼
Backend API
    │
    │ 2. Validate input
    │ 3. Build transaction
    ▼
Streaming Contract
    │
    │ 4. Validate parameters
    │ 5. Calculate rate_per_ledger = amount / (stop - start)
    │ 6. Call token.transfer(sender -> contract, amount)
    ▼
Token Contract
    │
    │ 7. Transfer tokens
    ◄───┘
    │
    │ 8. Store stream data
    │ 9. Emit "created" event
    ▼
Backend API
    │
    │ 10. Save to MongoDB
    │ 11. Return stream_id
    ▼
User/Sender
    │
    └─ Stream created! ✅
```

### 2. Withdraw Flow

```
User/Recipient
    │
    │ 1. POST /api/v1/streams/:id/withdraw
    │    {amount}
    ▼
Backend API
    │
    │ 2. Validate input
    │ 3. Build transaction
    ▼
Streaming Contract
    │
    │ 4. Verify recipient authorization
    │ 5. Calculate available = (rate × elapsed) - withdrawn
    │ 6. Validate amount <= available
    │ 7. Call token.transfer(contract -> recipient, amount)
    ▼
Token Contract
    │
    │ 8. Transfer tokens
    ◄───┘
    │
    │ 9. Update withdrawn += amount
    │ 10. Emit "withdraw" event
    ▼
Backend API
    │
    │ 11. Update MongoDB
    │ 12. Return success
    ▼
User/Recipient
    │
    └─ Tokens received! ✅
```

### 3. Cancel Stream Flow

```
User/Sender
    │
    │ 1. DELETE /api/v1/streams/:id
    ▼
Backend API
    │
    │ 2. Build transaction
    ▼
Streaming Contract
    │
    │ 3. Verify sender authorization
    │ 4. Calculate recipient_balance = streamed - withdrawn
    │ 5. Calculate refund = total - streamed
    │
    │ 6. If recipient_balance > 0:
    │    Call token.transfer(contract -> recipient, recipient_balance)
    ▼
Token Contract
    │
    │ 7. Transfer to recipient
    ◄───┘
    │
    │ 8. If refund > 0:
    │    Call token.transfer(contract -> sender, refund)
    ▼
Token Contract
    │
    │ 9. Transfer refund to sender
    ◄───┘
    │
    │ 10. Remove stream from storage
    │ 11. Emit "canceled" event
    ▼
Backend API
    │
    │ 12. Update MongoDB (status = canceled)
    │ 13. Return success
    ▼
User/Sender
    │
    └─ Stream canceled! Refund received! ✅
```

### 4. Balance Query Flow

```
User/Anyone
    │
    │ 1. GET /api/v1/streams/:id/balance
    ▼
Backend API
    │
    │ 2. Build read transaction
    ▼
Streaming Contract
    │
    │ 3. Get stream data
    │ 4. Get current ledger
    │ 5. Calculate elapsed = current - start
    │ 6. Calculate streamed = rate × elapsed
    │ 7. Calculate available = streamed - withdrawn
    │ 8. Return available
    ▼
Backend API
    │
    │ 9. Return balance
    ▼
User/Anyone
    │
    └─ Balance: X tokens ✅
```

## Component Interaction Matrix

```
┌──────────────┬──────────┬──────────┬──────────┬──────────┐
│              │ Frontend │ Backend  │ Contract │  Token   │
├──────────────┼──────────┼──────────┼──────────┼──────────┤
│ Frontend     │    -     │   HTTP   │    -     │    -     │
├──────────────┼──────────┼──────────┼──────────┼──────────┤
│ Backend      │   HTTP   │    -     │   RPC    │    -     │
├──────────────┼──────────┼──────────┼──────────┼──────────┤
│ Contract     │    -     │   RPC    │    -     │  Invoke  │
├──────────────┼──────────┼──────────┼──────────┼──────────┤
│ Token        │    -     │    -     │  Invoke  │    -     │
└──────────────┴──────────┴──────────┴──────────┴──────────┘
```

## Storage Architecture

```
┌─────────────────────────────────────────────────────────┐
│              PERSISTENT STORAGE (On-Chain)              │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  Stream(0) -> {                                         │
│    sender: GABC...,                                     │
│    recipient: GDEF...,                                  │
│    token: CXYZ...,                                      │
│    rate_per_ledger: 10,                                 │
│    start_ledger: 1000,                                  │
│    stop_ledger: 2000,                                   │
│    withdrawn: 5000                                      │
│  }                                                      │
│                                                         │
│  Stream(1) -> { ... }                                   │
│  Stream(2) -> { ... }                                   │
│                                                         │
└─────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│             INSTANCE STORAGE (On-Chain)                 │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  NextStreamId -> 3                                      │
│                                                         │
└─────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│              MONGODB (Off-Chain)                        │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  streams: [                                             │
│    {                                                    │
│      streamId: "0",                                     │
│      contractId: "C...",                                │
│      sender: "GABC...",                                 │
│      recipient: "GDEF...",                              │
│      tokenAddress: "CXYZ...",                           │
│      totalAmount: "10000",                              │
│      status: "active",                                  │
│      createdTxHash: "abc123...",                        │
│      createdAt: "2025-01-15T10:00:00Z"                  │
│    },                                                   │
│    ...                                                  │
│  ]                                                      │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

## Event Flow

```
Contract Events                Backend Processing
─────────────────             ──────────────────

created(stream_id)    ──────>  Save to MongoDB
  ├─ sender                     Update status: active
  ├─ recipient                  Store tx hash
  └─ total_amount               Index by sender/recipient

withdraw(stream_id)   ──────>  Update MongoDB
  ├─ recipient                  Update withdrawn amount
  └─ amount                     Log transaction

canceled(stream_id)   ──────>  Update MongoDB
  ├─ recipient_balance          Update status: canceled
  └─ refund_amount              Store cancel tx hash
                                Archive stream
```

## Security Layers

```
┌─────────────────────────────────────────────────────────┐
│                    USER LAYER                           │
│  - Wallet signature required                            │
│  - Private key never leaves wallet                      │
└────────────────────┬────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────┐
│                   API LAYER                             │
│  - Input validation (express-validator)                 │
│  - Rate limiting                                        │
│  - CORS protection                                      │
│  - HTTPS only                                           │
└────────────────────┬────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────┐
│                 CONTRACT LAYER                          │
│  - Authorization checks (require_auth)                  │
│  - Balance validation                                   │
│  - Parameter validation                                 │
│  - Integer overflow protection                          │
│  - Atomic operations                                    │
└────────────────────┬────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────┐
│                 NETWORK LAYER                           │
│  - Stellar consensus                                    │
│  - Transaction fees                                     │
│  - Ledger finality                                      │
└─────────────────────────────────────────────────────────┘
```

## Deployment Architecture

```
Development          Testing              Production
───────────          ───────              ──────────

Local Testnet   ->   Stellar Testnet ->   Stellar Mainnet
    │                     │                     │
    │                     │                     │
    ▼                     ▼                     ▼
Local MongoDB       Test MongoDB         Production MongoDB
    │                     │                     │
    │                     │                     │
    ▼                     ▼                     ▼
Local Backend       Test Backend         Production Backend
    │                     │                     │
    │                     │                     │
    ▼                     ▼                     ▼
Local Frontend      Test Frontend        Production Frontend
```

---

This architecture provides:
- ✅ Clear separation of concerns
- ✅ Scalable design
- ✅ Security at every layer
- ✅ Event-driven updates
- ✅ Efficient data flow
- ✅ Production-ready structure
