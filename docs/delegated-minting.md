# Delegated Minting System

## Overview

The Delegated Minting System allows token owners to grant minting permissions to other addresses (delegates) without transferring full administrative control. This enables decentralized token distribution, authorized minting partners, and flexible governance models.

## Key Features

- **Granular Delegation**: Owners can grant specific minting limits to delegates
- **Fee Sponsorship**: Optional sponsor addresses can cover protocol fees on delegated mints
- **Limit Enforcement**: Delegates cannot exceed their approved minting limit
- **Revocation**: Owners can revoke delegations at any time
- **Event Tracking**: All delegation actions emit events for off-chain auditing
- **Off-Chain Tracking**: Backend database tracks delegation state and history

## Architecture

### Smart Contract Layer

#### DataKey Variant
```rust
MintDelegate(Address, Address), // (owner, delegate)
```

#### MintDelegate Struct
```rust
pub struct MintDelegate {
    pub limit: i128,              // Maximum tokens delegate may mint
    pub minted: i128,             // Running total already minted
    pub sponsor: Option<Address>, // Optional fee sponsor
}
```

#### Contract Functions

**approve_minter(owner, delegate, limit, sponsor)**
- Grants `delegate` permission to mint up to `limit` tokens on behalf of `owner`
- Optional `sponsor` address absorbs protocol fees
- Requires `owner` authorization
- Emits `minter_ok` event

**revoke_minter(owner, delegate)**
- Revokes a previously granted delegation
- Requires `owner` authorization
- Emits `minter_rv` event

**delegate_mint(delegate, owner, to, amount)**
- Mints `amount` tokens to `to` using delegation from `owner`
- Requires `delegate` authorization
- Enforces limit and updates running total
- Handles fee sponsorship if configured
- Emits `dlg_mint` event

**mint_delegate(owner, delegate) -> Option<MintDelegate>**
- Query function to retrieve delegation details
- Returns None if delegation doesn't exist

### Backend Layer

#### Database Model (Delegation.js)
Tracks off-chain delegation state:
- `tokenContractId` - Token contract address
- `owner` - Owner granting delegation
- `delegate` - Address receiving delegation
- `limit` - Maximum minting limit
- `minted` - Running total minted
- `sponsor` - Optional fee sponsor
- `status` - 'active', 'revoked', or 'exhausted'
- `createdAt` - Delegation creation timestamp
- `revokedAt` - Revocation timestamp (if revoked)
- `lastMintedAt` - Last mint timestamp
- `totalMintCount` - Number of mint operations

#### Service Layer (delegation-service.js)
Provides business logic:
- `approveMinter()` - Create/update delegation
- `revokeMinter()` - Revoke delegation
- `delegateMint()` - Execute delegated mint
- `getDelegation()` - Query delegation details
- `getDelegationsByOwner()` - List owner's delegations
- `getDelegationsByDelegate()` - List delegate's delegations
- `getActiveDelegations()` - List all active delegations
- `getDelegationStats()` - Get delegation statistics
- `canMint()` - Check if delegation can mint amount

#### API Routes (delegation-routes.js)
REST endpoints for delegation management:
- `POST /api/delegation/approve` - Approve minter
- `POST /api/delegation/revoke` - Revoke minter
- `POST /api/delegation/mint` - Execute delegated mint
- `GET /api/delegation/:tokenContractId/:owner/:delegate` - Get delegation
- `GET /api/delegation/owner/:tokenContractId/:owner` - Get owner's delegations
- `GET /api/delegation/delegate/:tokenContractId/:delegate` - Get delegate's delegations
- `GET /api/delegation/active/:tokenContractId` - Get active delegations
- `GET /api/delegation/stats/:tokenContractId` - Get statistics
- `POST /api/delegation/can-mint` - Check if can mint

## Usage Workflows

### 1. Approve a Minter

**Contract Call:**
```rust
approve_minter(
  owner: G...,
  delegate: G...,
  limit: 1000000000,  // 1000 tokens with 7 decimals
  sponsor: Some(G...) // Optional fee sponsor
)
```

**API Call:**
```bash
POST /api/delegation/approve
{
  "tokenContractId": "C...",
  "owner": "G...",
  "delegate": "G...",
  "limit": "1000000000",
  "sponsor": "G..." // Optional
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "txHash": "...",
    "message": "Delegation approved: G... can mint up to 1000000000 tokens on behalf of G..."
  }
}
```

### 2. Execute Delegated Mint

**Contract Call:**
```rust
delegate_mint(
  delegate: G...,
  owner: G...,
  to: G...,
  amount: 100000000  // 100 tokens
)
```

**API Call:**
```bash
POST /api/delegation/mint
{
  "tokenContractId": "C...",
  "delegate": "G...",
  "owner": "G...",
  "to": "G...",
  "amount": "100000000"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "txHash": "...",
    "message": "Delegated mint executed: 100000000 tokens minted to G..."
  }
}
```

### 3. Revoke Delegation

**Contract Call:**
```rust
revoke_minter(
  owner: G...,
  delegate: G...
)
```

**API Call:**
```bash
POST /api/delegation/revoke
{
  "tokenContractId": "C...",
  "owner": "G...",
  "delegate": "G..."
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "txHash": "...",
    "message": "Delegation revoked: G... can no longer mint on behalf of G..."
  }
}
```

### 4. Query Delegation Status

**API Call:**
```bash
GET /api/delegation/C.../G.../G...
```

**Response:**
```json
{
  "success": true,
  "data": {
    "onChain": {
      "limit": "1000000000",
      "minted": "300000000",
      "sponsor": "G..."
    },
    "offChain": {
      "_id": "...",
      "tokenContractId": "C...",
      "owner": "G...",
      "delegate": "G...",
      "limit": "1000000000",
      "minted": "300000000",
      "sponsor": "G...",
      "status": "active",
      "createdAt": "2026-04-23T...",
      "lastMintedAt": "2026-04-23T...",
      "totalMintCount": 3
    }
  }
}
```

## Fee Sponsorship

When a sponsor is configured for a delegation, protocol fees are deducted from the sponsor's balance instead of the owner's balance.

### Fee Sponsorship Flow

1. **Delegation Created with Sponsor**
   ```
   approve_minter(owner, delegate, limit, Some(sponsor))
   ```

2. **Delegated Mint Executed**
   ```
   delegate_mint(delegate, owner, to, amount)
   ```

3. **Fee Calculation**
   - Fee = amount × fee_bps / 10000
   - Example: 100 tokens × 500 bps = 5 tokens fee

4. **Fee Deduction**
   - Sponsor balance: sponsor_balance - fee
   - Treasury balance: treasury_balance + fee
   - Recipient balance: recipient_balance + amount (full amount, no fee deduction)

5. **Event Emission**
   - `fee_collected` event with sponsor, treasury, and fee amount

### Sponsor Requirements

- Sponsor must have sufficient balance to cover fees
- If sponsor balance is insufficient, transaction panics
- Sponsor can be the same as owner or a different address
- Sponsor can be changed by revoking and re-approving delegation

## Security Considerations

### On-Chain Security
- **Authorization**: All operations require proper authorization
- **Limit Enforcement**: Delegates cannot exceed approved limits
- **Overflow Protection**: Safe arithmetic prevents integer overflows
- **Sponsor Validation**: Sponsor balance checked before fee deduction
- **Immutable Limits**: Limits can only be changed by revoking and re-approving

### Off-Chain Security
- **JWT Authentication**: All API endpoints require valid JWT tokens
- **Input Validation**: All inputs validated against expected formats
- **Database Indexing**: Efficient queries prevent performance attacks
- **Audit Trail**: All operations logged with timestamps
- **Status Tracking**: Delegations marked as revoked/exhausted for clarity

### Best Practices
1. **Limit Selection**: Set reasonable limits based on expected usage
2. **Sponsor Monitoring**: Monitor sponsor balance to prevent failed mints
3. **Regular Audits**: Review delegation history and statistics
4. **Revocation Policy**: Revoke unused delegations promptly
5. **Fee Configuration**: Ensure fee sponsor is aware of fee obligations

## Events

### minter_ok
Emitted when delegation is approved:
```
Topics: (Symbol("minter_ok"), owner, delegate)
Data: limit
```

### minter_rv
Emitted when delegation is revoked:
```
Topics: (Symbol("minter_rv"), owner, delegate)
Data: ()
```

### dlg_mint
Emitted when delegated mint occurs:
```
Topics: (Symbol("dlg_mint"), delegate, owner, to)
Data: (amount, new_balance, new_supply)
```

### fee_collected
Emitted when sponsor fee is collected:
```
Topics: (Symbol("fee_coll"), sponsor, treasury)
Data: fee_amount
```

## Testing

### Contract Tests
Located in `contracts/token/src/test.rs`:
- Delegation approval and revocation
- Limit enforcement
- Fee sponsorship logic
- Authorization checks
- Edge cases (overflow, insufficient balance)

### Integration Tests
- End-to-end delegation workflow
- Multi-delegation scenarios
- Fee sponsorship with various amounts
- Revocation and re-approval
- Database state consistency

## Deployment

### 1. Build Contract
```bash
cd contracts/token
cargo build --target wasm32-unknown-unknown --release
```

### 2. Deploy Contract
```bash
soroban contract deploy \
  --wasm target/wasm32-unknown-unknown/release/soromint_token.wasm \
  --network testnet
```

### 3. Initialize Backend
```bash
cd server
npm install
npm run migrate
npm start
```

### 4. Register Routes
Routes are automatically registered in `server/index.js`:
```javascript
app.use('/api/delegation', delegationRoutes);
```

## Monitoring

### Key Metrics
- Total delegations created
- Active delegations count
- Exhausted delegations count
- Total minting limit across all delegations
- Total minted through delegations
- Delegations with sponsors

### Health Checks
- Verify delegation status consistency
- Monitor sponsor balance adequacy
- Track failed mint attempts
- Audit delegation revocations

### Queries

**Get Statistics:**
```bash
GET /api/delegation/stats/C...
```

**Get Active Delegations:**
```bash
GET /api/delegation/active/C...
```

**Check Mint Capability:**
```bash
POST /api/delegation/can-mint
{
  "tokenContractId": "C...",
  "owner": "G...",
  "delegate": "G...",
  "amount": "100000000"
}
```

## Future Enhancements

1. **Time-Based Expiration**: Delegations that expire after a set period
2. **Delegation Chains**: Allow delegates to sub-delegate to others
3. **Batch Operations**: Approve multiple delegations in one transaction
4. **Delegation Marketplace**: Allow buying/selling delegation rights
5. **Governance Integration**: Multi-sig approval for high-value delegations
6. **Rate Limiting**: Limit mints per time period (e.g., per day)
7. **Delegation Tiers**: Different permission levels (mint, burn, transfer)
8. **Notification System**: Alert sponsors of fee deductions

## Troubleshooting

### "no delegation found"
- Delegation hasn't been approved yet
- Delegation was revoked
- Check owner and delegate addresses

### "delegate mint limit exceeded"
- Delegate has already minted up to their limit
- Revoke and re-approve with higher limit
- Or wait for delegation to be reset

### "sponsor has insufficient balance to cover fee"
- Sponsor doesn't have enough tokens for fee
- Transfer tokens to sponsor address
- Or remove sponsor and have owner pay fee

### "insufficient allowance"
- Delegate doesn't have approval to spend tokens
- Call `approve()` to grant spending rights
- Or use different delegate address

## Support

For issues or questions:
1. Check this documentation
2. Review contract events in blockchain explorer
3. Check backend logs for API errors
4. Contact the SoroMint team
