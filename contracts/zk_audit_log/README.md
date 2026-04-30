# Zero-Knowledge Audit Log Contract

## Overview

The ZK Audit Log contract provides a privacy-preserving audit trail for sensitive actions on the Stellar/Soroban blockchain. It uses Zero-Knowledge proof commitments to maintain accountability while protecting sensitive details.

## Features

- **Privacy-Preserving**: Sensitive action details are hidden behind ZK proof commitments
- **Accountability**: All actions are logged with verifiable proofs
- **Authorized Verifiers**: Only authorized addresses can submit audit entries
- **Proof Verification**: Supports verification of ZK proofs against commitments
- **Queryable History**: Retrieve audit entries individually or in batches

## Architecture

### Action Types

The contract supports auditing the following action types:
- `Mint` (1): Token minting operations
- `Burn` (2): Token burning operations
- `Transfer` (3): Token transfers
- `AdminChange` (4): Administrative changes
- `RoleGrant` (5): Role grants
- `RoleRevoke` (6): Role revocations
- `ContractUpgrade` (7): Contract upgrades
- `ConfigChange` (8): Configuration changes

### Audit Entry Structure

Each audit entry contains:
- `entry_id`: Unique identifier
- `action_type`: Type of action being audited
- `timestamp`: Ledger timestamp
- `proof_commitment`: Hash commitment of the ZK proof (32 bytes)
- `public_data_hash`: Hash of non-sensitive public metadata (32 bytes)
- `verifier`: Address that submitted the entry

### Zero-Knowledge Proof Flow

1. **Off-chain**: Generate a ZK proof for the sensitive action
2. **Commitment**: Create a hash commitment of the proof (e.g., SHA-256)
3. **Log**: Submit the commitment and public data hash to the contract
4. **Verification**: Later, submit the actual proof to verify against the commitment

## Usage

### Initialize

```rust
initialize(admin: Address)
```

Sets up the contract with an initial admin who is also a verifier.

### Manage Verifiers

```rust
add_verifier(admin: Address, verifier: Address)
remove_verifier(admin: Address, verifier: Address)
is_verifier(address: Address) -> bool
```

### Log Actions

```rust
log_action(
    verifier: Address,
    action_type: ActionType,
    proof_commitment: BytesN<32>,
    public_data_hash: BytesN<32>
) -> u64
```

Logs a sensitive action with a ZK proof commitment. Returns the entry ID.

**Example**:
```rust
// Off-chain: Generate ZK proof
let proof = generate_zk_proof(sensitive_data);
let commitment = sha256(proof);
let public_hash = sha256(public_metadata);

// On-chain: Log the action
let entry_id = contract.log_action(
    verifier,
    ActionType::Mint,
    commitment,
    public_hash
);
```

### Verify Proofs

```rust
verify_proof(
    verifier: Address,
    entry_id: u64,
    proof_data: Bytes
) -> bool
```

Verifies that the provided proof data matches the stored commitment.

### Query Entries

```rust
get_entry(entry_id: u64) -> Option<AuditEntry>
get_entry_count() -> u64
get_entries(start_id: u64, limit: u32) -> Vec<AuditEntry>
is_proof_verified(entry_id: u64) -> bool
```

## Security Considerations

### Current Implementation

This is a **minimal implementation** suitable for demonstration and development. The proof verification currently uses simple hash matching (SHA-256).

### Production Recommendations

For production use, consider:

1. **ZK Proof System Integration**: Integrate with a proper ZK proof system:
   - **zk-SNARKs** (e.g., Groth16, PLONK)
   - **zk-STARKs** for post-quantum security
   - **Bulletproofs** for range proofs

2. **Proof Verification**: Implement actual cryptographic verification:
   - Pairing-based verification for SNARKs
   - Polynomial commitment verification for STARKs
   - Use specialized ZK libraries

3. **Commitment Schemes**: Use cryptographic commitments:
   - Pedersen commitments
   - Kate commitments
   - Merkle tree commitments

4. **Access Control**: Implement fine-grained access control:
   - Separate roles for different action types
   - Time-based access restrictions
   - Multi-signature requirements

5. **Storage Optimization**: For large-scale deployments:
   - Use Merkle trees for efficient batch verification
   - Implement archival strategies for old entries
   - Consider off-chain storage with on-chain anchoring

## Integration Example

### With Token Minting

```rust
// In your token contract
pub fn mint(env: Env, to: Address, amount: i128) {
    // ... minting logic ...
    
    // Generate ZK proof off-chain
    let proof_commitment = generate_mint_proof_commitment(&env, to, amount);
    let public_hash = hash_public_data(&env, to);
    
    // Log to audit contract
    let audit_contract = ZkAuditLogContractClient::new(&env, &audit_contract_id);
    audit_contract.log_action(
        &verifier,
        &ActionType::Mint,
        &proof_commitment,
        &public_hash
    );
}
```

### With Access Control

```rust
// In your access control contract
pub fn grant_role(env: Env, admin: Address, user: Address, role: Role) {
    admin.require_auth();
    
    // ... role granting logic ...
    
    // Log to audit
    let proof_commitment = generate_role_proof_commitment(&env, user, role);
    let public_hash = hash_role_data(&env, role);
    
    audit_contract.log_action(
        &admin,
        &ActionType::RoleGrant,
        &proof_commitment,
        &public_hash
    );
}
```

## Events

The contract emits the following events:

- `audit_log`: When an action is logged
- `proof_vf`: When a proof is verified
- `ver_add`: When a verifier is added
- `ver_rem`: When a verifier is removed

## Testing

Run tests with:
```bash
cargo test -p soromint-zk-audit-log
```

## Future Enhancements

- [ ] Integration with actual ZK proof libraries
- [ ] Support for multiple proof systems
- [ ] Batch proof verification
- [ ] Merkle tree-based audit trails
- [ ] Off-chain proof generation tools
- [ ] Public verification interface
- [ ] Proof aggregation for efficiency

## License

This contract is part of the SoroMint project.

## Related Issues

Closes #168
