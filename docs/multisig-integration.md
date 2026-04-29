# Multi-Sig Token Administrator Integration

## Overview

The SoroMint platform now supports multi-signature (multi-sig) accounts as token administrators. This enables decentralized governance and enhanced security for token operations by requiring multiple parties to approve administrative actions.

## Architecture

### Smart Contract Layer

#### MultiSigAdmin Contract (`contracts/multisig/src/lib.rs`)

The multi-sig contract manages:
- **Signers**: A list of authorized addresses that can propose and approve transactions
- **Threshold**: Minimum number of signatures required to execute a transaction
- **Pending Transactions**: Queue of proposed administrative actions awaiting approval

**Key Functions:**
- `initialize(signers: Vec<Address>, threshold: u32)` - Set up multi-sig with signers and threshold
- `propose_tx(proposer, target, function, args)` - Propose a new administrative action
- `approve_tx(signer, tx_id)` - Add approval signature to a pending transaction
- `execute_tx(executor, tx_id)` - Execute a transaction once threshold is met
- `get_tx(tx_id)` - Retrieve transaction details
- `get_signers()` - List all authorized signers
- `get_threshold()` - Get required signature count

#### Factory Integration

The `TokenFactory` contract has been extended with:
- `create_token_with_multisig()` - Deploy tokens with multi-sig admin support
- Event tagging to distinguish multi-sig deployments

### Backend Layer

#### MultiSigTransaction Model

Tracks off-chain coordination of multi-sig transactions:
```javascript
{
  txId: String,
  multiSigContractId: String,
  tokenContractId: String,
  targetFunction: String, // 'mint', 'burn', 'transfer_ownership', etc.
  functionArgs: Mixed,
  proposer: String,
  signatures: [{
    signer: String,
    signedAt: Date,
    signature: String
  }],
  requiredSignatures: Number,
  status: 'pending' | 'approved' | 'executed' | 'rejected',
  executedAt: Date,
  executedBy: String,
  executionTxHash: String,
  expiresAt: Date
}
```

#### MultiSigService

Coordinates multi-sig operations:
- `proposeTransaction()` - Create new proposal
- `approveTransaction()` - Add signature
- `executeTransaction()` - Execute approved transaction
- `getPendingTransactions()` - List pending proposals
- `getSigners()` / `getThreshold()` - Query multi-sig configuration

#### API Endpoints (`/api/multisig`)

- `POST /propose` - Propose new administrative action
- `POST /approve/:txId` - Approve pending transaction
- `POST /execute/:txId` - Execute approved transaction
- `GET /pending/:multiSigContractId` - List pending transactions
- `GET /transaction/:txId` - Get transaction details
- `GET /signers/:multiSigContractId` - Get signers and threshold

## Usage Workflow

### 1. Deploy Multi-Sig Contract

```javascript
const multiSigContract = new MultiSigAdminClient(env);
await multiSigContract.initialize({
  signers: [signer1Address, signer2Address, signer3Address],
  threshold: 2 // Require 2 out of 3 signatures
});
```

### 2. Deploy Token with Multi-Sig Admin

```javascript
const factory = new TokenFactoryClient(env, factoryId);
const tokenAddress = await factory.create_token_with_multisig({
  salt: generateSalt(),
  admin: multiSigContractAddress, // Use multi-sig as admin
  decimal: 7,
  name: "Governed Token",
  symbol: "GTKN",
  is_multisig: true
});
```

### 3. Propose Administrative Action

```javascript
// Signer 1 proposes minting 1000 tokens
const response = await fetch('/api/multisig/propose', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${jwt}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    multiSigContractId: 'C...',
    tokenContractId: 'C...',
    targetFunction: 'mint',
    functionArgs: {
      to: 'G...',
      amount: 1000000000 // 1000 tokens with 7 decimals
    }
  })
});

const { data: { txId } } = await response.json();
```

### 4. Approve Transaction

```javascript
// Signer 2 approves the proposal
await fetch(`/api/multisig/approve/${txId}`, {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${signer2Jwt}`
  }
});
```

### 5. Execute Transaction

```javascript
// Once threshold is met, any signer can execute
await fetch(`/api/multisig/execute/${txId}`, {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${jwt}`
  }
});
```

## Security Considerations

### On-Chain Security
- **Signer Verification**: Only registered signers can propose, approve, or execute
- **Threshold Enforcement**: Transactions cannot execute without sufficient signatures
- **Replay Protection**: Each transaction has a unique ID and can only be executed once
- **Authorization**: All operations require `require_auth()` from the caller

### Off-Chain Security
- **JWT Authentication**: All API endpoints require valid JWT tokens
- **Signer Validation**: Backend verifies signers against on-chain multi-sig configuration
- **Expiration**: Transactions expire after 7 days to prevent stale proposals
- **Audit Trail**: All proposals, approvals, and executions are logged

### Best Practices
1. **Threshold Selection**: Use at least 2-of-3 or 3-of-5 for production tokens
2. **Signer Distribution**: Distribute signing keys across different individuals/organizations
3. **Regular Audits**: Monitor pending transactions and execution history
4. **Key Rotation**: Plan for signer updates through ownership transfer
5. **Emergency Procedures**: Document process for handling compromised signers

## Supported Administrative Functions

All token administrative functions support multi-sig:
- `mint(to, amount)` - Create new tokens
- `burn(from, amount)` - Destroy tokens
- `transfer_ownership(new_admin)` - Change administrator
- `set_fee_config(enabled, fee_bps, treasury)` - Configure transfer fees
- `pause()` - Pause token operations
- `unpause()` - Resume token operations

## Testing

### Contract Tests
```bash
cd contracts/multisig
cargo test
```

### Integration Tests
```bash
cd server
npm test -- multisig
```

## Deployment

### 1. Build Multi-Sig Contract
```bash
cd contracts/multisig
cargo build --target wasm32-unknown-unknown --release
```

### 2. Deploy to Network
```bash
soroban contract deploy \
  --wasm target/wasm32-unknown-unknown/release/soromint_multisig.wasm \
  --network testnet
```

### 3. Initialize Multi-Sig
```bash
soroban contract invoke \
  --id <CONTRACT_ID> \
  --network testnet \
  -- initialize \
  --signers '["G...","G...","G..."]' \
  --threshold 2
```

## Monitoring

### Query Pending Transactions
```bash
GET /api/multisig/pending/<multiSigContractId>
```

### Check Transaction Status
```bash
GET /api/multisig/transaction/<txId>
```

### View Signers
```bash
GET /api/multisig/signers/<multiSigContractId>
```

## Future Enhancements

- **Time-locks**: Add delay between approval and execution
- **Proposal Cancellation**: Allow proposers to cancel pending transactions
- **Weighted Voting**: Support different voting weights per signer
- **Batch Execution**: Execute multiple approved transactions atomically
- **Notification System**: Alert signers of new proposals via webhook/email
