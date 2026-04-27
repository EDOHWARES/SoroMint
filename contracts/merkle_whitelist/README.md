# Merkle Proof Whitelist Contract

A gas-efficient whitelisting mechanism using Merkle proofs that allows thousands of addresses to be whitelisted for a fraction of the cost of traditional storage-based approaches.

## Overview

Instead of storing each whitelisted address on-chain (which becomes prohibitively expensive for large lists), this contract stores only a single 32-byte Merkle root. Users prove their whitelist status by providing a Merkle proof, which is verified against the stored root.

## Gas Efficiency Comparison

### Traditional Whitelist (Storage-based)
- **Cost per address**: ~20,000 gas
- **1,000 addresses**: ~20,000,000 gas
- **10,000 addresses**: ~200,000,000 gas

### Merkle Whitelist
- **Initial setup**: ~5,000 gas (single root storage)
- **1,000 addresses**: ~5,000 gas
- **10,000 addresses**: ~5,000 gas
- **Verification per user**: ~3,000-5,000 gas (depending on tree depth)

**Savings**: Up to 99.9% reduction in gas costs for large whitelists!

## How It Works

1. **Off-chain**: Build a Merkle tree from all whitelisted addresses
2. **On-chain**: Store only the Merkle root (32 bytes)
3. **Verification**: Users provide their address + Merkle proof
4. **Contract**: Verifies the proof against the stored root

## Features

- ✅ **Gas Efficient**: Store thousands of addresses with minimal cost
- ✅ **Updatable**: Admin can update the Merkle root to change the whitelist
- ✅ **Versioned**: Track whitelist versions for auditing
- ✅ **Nonce Support**: Prevent replay attacks for one-time actions
- ✅ **Batch Verification**: Verify multiple addresses in one call
- ✅ **Secure**: Uses SHA-256 hashing with sorted pairs

## Contract Functions

### Admin Functions

#### `initialize(admin: Address, merkle_root: BytesN<32>)`
Initialize the contract with an admin and initial Merkle root.

#### `update_merkle_root(new_root: BytesN<32>)`
Update the Merkle root to change the whitelist (admin only).

#### `transfer_admin(new_admin: Address)`
Transfer admin rights to a new address.

### Verification Functions

#### `verify_whitelist(address: Address, proof: Vec<BytesN<32>>) -> bool`
Verify if an address is whitelisted using a Merkle proof.

#### `claim_whitelist(address: Address, proof: Vec<BytesN<32>>)`
Claim whitelist status (requires valid proof and authorization).

#### `verify_with_nonce(address: Address, proof: Vec<BytesN<32>>, nonce: u64) -> bool`
Verify whitelist with nonce to prevent replay attacks.

#### `batch_verify(addresses: Vec<Address>, proofs: Vec<Vec<BytesN<32>>>) -> Vec<bool>`
Verify multiple addresses in a single call.

### Query Functions

#### `get_merkle_root() -> BytesN<32>`
Get the current Merkle root.

#### `get_root_version() -> u32`
Get the current root version number.

#### `get_config() -> WhitelistConfig`
Get complete whitelist configuration.

#### `is_nonce_used(address: Address, nonce: u64) -> bool`
Check if a nonce has been used.

## Usage Example

### Building the Merkle Tree (Off-chain)

```javascript
// Example using JavaScript/TypeScript
import { MerkleTree } from 'merkletreejs';
import { sha256 } from 'js-sha256';

// List of whitelisted addresses
const addresses = [
  'GABC...',
  'GDEF...',
  'GHIJ...',
  // ... thousands more
];

// Create leaves (hash each address)
const leaves = addresses.map(addr => sha256(addr));

// Build Merkle tree
const tree = new MerkleTree(leaves, sha256, { sortPairs: true });

// Get root to store on-chain
const root = tree.getRoot();

// Get proof for a specific address
const leaf = sha256(addresses[0]);
const proof = tree.getProof(leaf);
```

### Verifying Whitelist (On-chain)

```rust
// User provides their proof
let proof = vec![
    BytesN::from_array(&e, &proof_element_1),
    BytesN::from_array(&e, &proof_element_2),
    // ... more proof elements
];

// Verify whitelist status
let is_whitelisted = client.verify_whitelist(&user_address, &proof);

if is_whitelisted {
    // Grant access
} else {
    // Deny access
}
```

### Integration Example

```rust
// In your token sale contract
pub fn purchase_tokens(e: Env, buyer: Address, proof: Vec<BytesN<32>>, amount: i128) {
    buyer.require_auth();
    
    // Verify buyer is whitelisted
    let whitelist = MerkleWhitelistClient::new(&e, &whitelist_contract_id);
    if !whitelist.verify_whitelist(&buyer, &proof) {
        panic!("not whitelisted");
    }
    
    // Process purchase
    // ...
}
```

## Merkle Tree Structure

```
                    Root
                   /    \
                  /      \
                 /        \
              Hash1      Hash2
              /  \        /  \
             /    \      /    \
          Hash3  Hash4 Hash5  Hash6
          /  \   /  \   /  \   /  \
        Addr1 Addr2 Addr3 Addr4 Addr5 Addr6
```

## Security Features

1. **Sorted Pairs**: Hashes are sorted before combining to prevent second preimage attacks
2. **SHA-256**: Uses cryptographically secure hash function
3. **Nonce Protection**: Optional nonce system prevents replay attacks
4. **Authorization**: All state-changing operations require proper authentication
5. **Immutable Proofs**: Proofs are deterministic and cannot be forged

## Gas Optimization Tips

1. **Tree Depth**: Keep tree balanced for optimal proof size
2. **Batch Operations**: Use `batch_verify` for multiple verifications
3. **Proof Caching**: Cache proofs off-chain for repeated use
4. **Update Strategy**: Batch whitelist updates to minimize root changes

## Proof Size

The proof size depends on the tree depth:

| Addresses | Tree Depth | Proof Elements |
|-----------|------------|----------------|
| 2-4       | 2          | 2              |
| 5-8       | 3          | 3              |
| 9-16      | 4          | 4              |
| 17-32     | 5          | 5              |
| 1,000     | 10         | 10             |
| 10,000    | 14         | 14             |
| 100,000   | 17         | 17             |

## Use Cases

1. **Token Sales**: Whitelist participants for ICO/IDO
2. **Airdrops**: Efficiently distribute tokens to thousands of addresses
3. **Access Control**: Gate features to whitelisted users
4. **Governance**: Restrict voting to eligible addresses
5. **NFT Minting**: Whitelist for exclusive mints
6. **Staking Rewards**: Verify eligibility for reward claims

## Testing

The contract includes comprehensive tests:

```bash
cargo test --package merkle_whitelist
```

Tests cover:
- ✅ Single and multiple address verification
- ✅ Invalid proof rejection
- ✅ Root updates and versioning
- ✅ Nonce-based verification
- ✅ Batch verification
- ✅ Large whitelist simulation (100+ addresses)
- ✅ Admin transfer
- ✅ Replay attack prevention

## Limitations

1. **Off-chain Computation**: Merkle tree must be built off-chain
2. **Proof Distribution**: Users must obtain their proofs (can be automated)
3. **Update Cost**: Changing the whitelist requires updating the root
4. **Proof Storage**: Users/frontend must store proofs (not on-chain)

## Best Practices

1. **Backup Proofs**: Store proofs in multiple locations
2. **Version Tracking**: Keep track of which root version each proof is for
3. **API Endpoint**: Provide an API for users to retrieve their proofs
4. **Documentation**: Document the whitelist update process
5. **Testing**: Test with production-size datasets before deployment

## Comparison with Alternatives

### vs. Storage-based Whitelist
- ✅ 99%+ gas savings
- ✅ Scales to millions of addresses
- ❌ Requires off-chain proof generation

### vs. Signature-based Whitelist
- ✅ No per-user signature required
- ✅ Publicly verifiable
- ✅ No centralized signer needed
- ❌ Slightly more complex setup

## License

This contract is part of the SoroMint platform.
