# Cross-Chain Bridge Receiver Contract

## Overview

The Bridge Receiver contract provides a secure interface for receiving cross-chain 'mint' signals from bridge relayers after verification. It enables tokens to be minted on Soroban in response to lock/burn events on other blockchains.

## Features

- **Multi-Chain Support**: Supports signals from Ethereum, BSC, Polygon, Avalanche, and other chains
- **Authorized Relayers**: Only authorized relayers can submit mint signals
- **Replay Protection**: Prevents duplicate processing of source transactions
- **Verification Proofs**: Supports cryptographic proof verification
- **Emergency Pause**: Admin can pause operations in case of issues
- **Signal Tracking**: Complete history of all bridge operations
- **Status Management**: Track signal lifecycle from pending to executed

## Architecture

### Source Chains

Supported source chains:
- Ethereum
- Binance Smart Chain
- Polygon
- Avalanche
- Arbitrum
- Optimism
- Base
- Other (custom chains)

### Bridge Status Flow

```
Pending → Verified → Executed
   ↓
Failed/Cancelled
```

### Mint Signal Structure

Each mint signal contains:
- `signal_id`: Unique identifier
- `source_chain`: Origin blockchain
- `source_tx_hash`: Transaction hash on source chain (32 bytes)
- `recipient`: Soroban address to receive tokens
- `token_address`: Token contract address
- `amount`: Amount to mint
- `nonce`: Unique nonce for replay protection
- `timestamp`: Ledger timestamp
- `status`: Current status
- `relayer`: Address that submitted the signal
- `verification_proof`: Cryptographic proof data

## Usage

### Initialize

```rust
initialize(admin: Address, token_contract: Address)
```

Sets up the contract with an admin and the token contract to mint.

### Manage Relayers

```rust
add_relayer(admin: Address, relayer: Address)
remove_relayer(admin: Address, relayer: Address)
is_relayer(address: Address) -> bool
```

### Emergency Controls

```rust
pause(admin: Address)
unpause(admin: Address)
is_paused() -> bool
```

### Receive Mint Signal

```rust
receive_mint_signal(
    relayer: Address,
    source_chain: SourceChain,
    source_tx_hash: BytesN<32>,
    recipient: Address,
    amount: i128,
    nonce: u64,
    verification_proof: Bytes
) -> u64
```

Receives a mint signal from a bridge relayer. Returns the signal ID.

**Example**:
```rust
let signal_id = contract.receive_mint_signal(
    relayer,
    SourceChain::Ethereum,
    eth_tx_hash,
    soroban_recipient,
    1000_0000000, // 1000 tokens with 7 decimals
    nonce,
    merkle_proof
);
```

### Execute Mint Signal

```rust
execute_mint_signal(
    relayer: Address,
    signal_id: u64
) -> bool
```

Verifies and executes a mint signal. Returns true if successful.

**Example**:
```rust
let success = contract.execute_mint_signal(relayer, signal_id);
```

### Query Signals

```rust
get_signal(signal_id: u64) -> Option<MintSignal>
get_signal_count() -> u64
get_signals(start_id: u64, limit: u32) -> Vec<MintSignal>
is_tx_processed(source_tx_hash: BytesN<32>) -> bool
```

## Security Features

### 1. Replay Protection

The contract tracks processed source transactions to prevent replay attacks:

```rust
// Check if transaction already processed
if is_tx_processed(&source_tx_hash) {
    panic!("Transaction already processed");
}
```

### 2. Authorization

Only authorized relayers can submit and execute signals:

```rust
require_relayer(&relayer);
```

### 3. Emergency Pause

Admin can pause all operations:

```rust
pause(admin);
// All receive_mint_signal and execute_mint_signal calls will fail
```

### 4. Verification Proofs

Signals include cryptographic proofs for verification:
- Merkle proofs for transaction inclusion
- Multi-signature verification
- ZK proofs for privacy-preserving bridges

## Integration

### With Bridge Relayer

The bridge relayer watches for lock/burn events on source chains and submits mint signals:

```javascript
// Off-chain relayer (Node.js example)
bridgeContract.on('TokensLocked', async (event) => {
  const { txHash, recipient, amount } = event;
  
  // Generate Merkle proof
  const proof = await generateMerkleProof(txHash);
  
  // Submit to Soroban
  await sorobanBridge.receive_mint_signal(
    relayer,
    'Ethereum',
    txHash,
    recipient,
    amount,
    nonce,
    proof
  );
});
```

### With Token Contract

The bridge receiver calls the token contract to mint:

```rust
// In execute_mint_signal (production implementation)
let token_client = TokenContractClient::new(&env, &signal.token_address);
token_client.mint(&signal.recipient, &signal.amount);
```

## Bridge Flow

### Complete Cross-Chain Flow

```
Source Chain (Ethereum)
    │
    │ 1. User locks tokens
    │    TokenBridge.lock(amount, sorobanRecipient)
    ▼
Bridge Contract (Ethereum)
    │
    │ 2. Emit LockEvent
    │    event TokensLocked(txHash, recipient, amount)
    ▼
Bridge Relayer (Off-chain)
    │
    │ 3. Detect event
    │ 4. Generate Merkle proof
    │ 5. Submit to Soroban
    ▼
Bridge Receiver (Soroban)
    │
    │ 6. Receive signal
    │ 7. Verify proof
    │ 8. Check replay protection
    ▼
Token Contract (Soroban)
    │
    │ 9. Mint tokens
    │ 10. Transfer to recipient
    ▼
User receives tokens on Soroban ✅
```

## Verification Methods

### Current Implementation

The current implementation uses simplified verification:
- Checks that proof data is not empty
- Suitable for development and testing

### Production Recommendations

For production, implement robust verification:

#### 1. Merkle Proof Verification

```rust
fn verify_merkle_proof(
    root: BytesN<32>,
    leaf: BytesN<32>,
    proof: Vec<BytesN<32>>
) -> bool {
    let mut computed_hash = leaf;
    for proof_element in proof {
        computed_hash = hash_pair(computed_hash, proof_element);
    }
    computed_hash == root
}
```

#### 2. Multi-Signature Verification

```rust
fn verify_multisig(
    message: Bytes,
    signatures: Vec<Signature>,
    threshold: u32
) -> bool {
    let valid_sigs = signatures.iter()
        .filter(|sig| verify_signature(message, sig))
        .count();
    valid_sigs >= threshold
}
```

#### 3. Light Client Verification

Integrate with a light client to verify block headers and transaction inclusion.

## Events

The contract emits the following events:

- `sig_recv`: Signal received
- `sig_vrfy`: Signal verified
- `sig_exec`: Signal executed
- `sig_fail`: Signal failed
- `rel_add`: Relayer added
- `rel_rem`: Relayer removed
- `paused`: Contract paused
- `unpaused`: Contract unpaused

## Testing

Run tests with:
```bash
cargo test -p soromint-bridge-receiver
```

## Configuration

### Environment Variables (for relayer)

```bash
BRIDGE_RELAYER_ENABLED=true
BRIDGE_RELAYER_DIRECTION=evm-to-soroban
BRIDGE_SOROBAN_CONTRACT_ID=C...
BRIDGE_EVM_RPC_URL=https://eth-mainnet.g.alchemy.com/v2/...
BRIDGE_EVM_BRIDGE_ADDRESS=0x...
```

## Future Enhancements

- [ ] Integration with actual token minting
- [ ] Support for multiple token contracts
- [ ] Advanced proof verification (Merkle, ZK)
- [ ] Light client integration
- [ ] Batch signal processing
- [ ] Fee mechanism for relayers
- [ ] Slashing for malicious relayers
- [ ] Cross-chain message passing (not just minting)
- [ ] Support for NFT bridging

## Security Considerations

### Relayer Trust Model

- Relayers are trusted entities
- Consider implementing:
  - Multi-relayer consensus
  - Stake/slashing mechanisms
  - Fraud proofs
  - Challenge periods

### Proof Verification

- Current implementation is simplified
- Production must verify:
  - Transaction inclusion in source chain
  - Block finality
  - Validator signatures

### Emergency Response

- Admin can pause operations
- Consider implementing:
  - Timelock for admin actions
  - Multi-sig admin control
  - Upgrade mechanisms

## License

This contract is part of the SoroMint project.

## Related Issues

Closes #193
