# Proof-of-Burn Contract

## Overview

The Proof-of-Burn contract monitors 'burn' events and creates verifiable certificates that can be displayed on a public 'proof-of-burn' page. It provides transparency and accountability for token burning operations.

## Features

- **Burn Certificates**: Create immutable certificates for every burn event
- **Multiple Burn Reasons**: Support various burn scenarios (deflationary, bridge, redemption, etc.)
- **Verification System**: Authorized verifiers can confirm burn events
- **Public Display**: Certificates can be displayed on a public page
- **Comprehensive Tracking**: Track burns by burner, token, and reason
- **Statistics**: Aggregate burn statistics across the platform
- **Revocation**: Admin can revoke fraudulent certificates

## Architecture

### Burn Reasons

Supported burn reasons:
- `Deflationary`: Reduce total supply
- `CrossChainBridge`: Bridge to another chain
- `Redemption`: Redeem for another asset
- `Penalty`: Penalty or slashing
- `Upgrade`: Token upgrade/migration
- `Governance`: Governance decision
- `Other`: Custom reason with description

### Certificate Status

```
Active → Verified
   ↓
Revoked
```

### Burn Certificate Structure

Each certificate contains:
- `certificate_id`: Unique identifier
- `burner`: Address that burned tokens
- `token_address`: Token contract address
- `amount`: Amount burned
- `burn_reason`: Reason for burning
- `timestamp`: Ledger timestamp
- `ledger_sequence`: Ledger sequence number
- `transaction_hash`: Hash of burn transaction (32 bytes)
- `status`: Current status (Active/Verified/Revoked)
- `metadata`: Additional metadata (JSON string)
- `verifier`: Optional verifier who confirmed the burn

## Usage

### Initialize

```rust
initialize(admin: Address)
```

Sets up the contract with an admin who is also the initial verifier.

### Manage Verifiers

```rust
add_verifier(admin: Address, verifier: Address)
remove_verifier(admin: Address, verifier: Address)
is_verifier(address: Address) -> bool
```

### Public Display Settings

```rust
set_public_display(admin: Address, enabled: bool)
is_public_display_enabled() -> bool
```

### Record Burn

```rust
record_burn(
    burner: Address,
    token_address: Address,
    amount: i128,
    burn_reason: BurnReason,
    transaction_hash: BytesN<32>,
    metadata: String
) -> u64
```

Records a burn event and creates a certificate. Returns the certificate ID.

**Example**:
```rust
let metadata = String::from_str(&env, r#"{"purpose":"reduce supply","campaign":"Q1-2024"}"#);

let cert_id = contract.record_burn(
    burner,
    token_address,
    1000_0000000, // 1000 tokens with 7 decimals
    BurnReason::Deflationary,
    tx_hash,
    metadata
);
```

### Verify Certificate

```rust
verify_certificate(verifier: Address, certificate_id: u64)
```

Authorized verifiers can confirm that a burn actually occurred.

**Example**:
```rust
contract.verify_certificate(verifier, cert_id);
```

### Revoke Certificate

```rust
revoke_certificate(admin: Address, certificate_id: u64)
```

Admin can revoke fraudulent or erroneous certificates.

### Query Certificates

```rust
get_certificate(certificate_id: u64) -> Option<BurnCertificate>
get_certificate_count() -> u64
get_certificates(start_id: u64, limit: u32) -> Vec<BurnCertificate>
get_burner_certificates(burner: Address) -> Vec<u64>
get_token_certificates(token_address: Address) -> Vec<u64>
get_total_burned(token_address: Address) -> i128
get_burn_stats() -> BurnStats
```

## Integration

### With Token Contract

Integrate burn recording into your token contract:

```rust
// In your token contract
pub fn burn(env: Env, from: Address, amount: i128) {
    from.require_auth();
    
    // Perform the burn
    let balance = get_balance(&env, &from);
    if balance < amount {
        panic!("Insufficient balance");
    }
    set_balance(&env, &from, balance - amount);
    
    // Update total supply
    let total_supply = get_total_supply(&env);
    set_total_supply(&env, total_supply - amount);
    
    // Record in proof-of-burn contract
    let pob_contract = ProofOfBurnContractClient::new(&env, &pob_contract_id);
    let tx_hash = env.ledger().transaction_hash();
    let metadata = String::from_str(&env, r#"{"type":"user_burn"}"#);
    
    pob_contract.record_burn(
        &from,
        &env.current_contract_address(),
        &amount,
        &BurnReason::Deflationary,
        &tx_hash,
        &metadata
    );
    
    // Emit burn event
    env.events().publish((symbol_short!("burn"),), (from, amount));
}
```

### With Bridge Contract

Record burns for cross-chain bridges:

```rust
// In your bridge contract
pub fn burn_for_bridge(env: Env, from: Address, amount: i128, dest_chain: String) {
    from.require_auth();
    
    // Burn tokens
    token_contract.burn(&from, &amount);
    
    // Record burn certificate
    let metadata = String::from_str(
        &env,
        &format!(r#"{{"destination":"{}","bridge_id":"xyz"}}"#, dest_chain)
    );
    
    pob_contract.record_burn(
        &from,
        &token_address,
        &amount,
        &BurnReason::CrossChainBridge,
        &tx_hash,
        &metadata
    );
}
```

## Public Display Page

### Frontend Integration

Create a public page to display burn certificates:

```javascript
// Fetch all certificates
async function fetchBurnCertificates(startId, limit) {
  const certificates = await contract.get_certificates({
    start_id: startId,
    limit: limit
  });
  
  return certificates.map(cert => ({
    id: cert.certificate_id,
    burner: cert.burner,
    token: cert.token_address,
    amount: cert.amount,
    reason: cert.burn_reason,
    timestamp: new Date(cert.timestamp * 1000),
    status: cert.status,
    verified: cert.verifier !== null,
    metadata: JSON.parse(cert.metadata)
  }));
}

// Display certificates
function displayCertificates(certificates) {
  return certificates.map(cert => `
    <div class="burn-certificate ${cert.status}">
      <h3>Certificate #${cert.id}</h3>
      <p><strong>Amount:</strong> ${formatAmount(cert.amount)}</p>
      <p><strong>Token:</strong> ${cert.token}</p>
      <p><strong>Burner:</strong> ${cert.burner}</p>
      <p><strong>Reason:</strong> ${cert.reason}</p>
      <p><strong>Date:</strong> ${cert.timestamp.toLocaleString()}</p>
      ${cert.verified ? '<span class="verified">✓ Verified</span>' : ''}
    </div>
  `).join('');
}
```

### Statistics Dashboard

```javascript
// Fetch burn statistics
async function fetchBurnStats() {
  const stats = await contract.get_burn_stats();
  
  return {
    totalBurns: stats.total_burns,
    totalAmountBurned: stats.total_amount_burned,
    uniqueBurners: stats.unique_burners,
    uniqueTokens: stats.unique_tokens
  };
}

// Display statistics
function displayStats(stats) {
  return `
    <div class="burn-stats">
      <div class="stat">
        <h4>Total Burns</h4>
        <p>${stats.totalBurns.toLocaleString()}</p>
      </div>
      <div class="stat">
        <h4>Total Amount Burned</h4>
        <p>${formatAmount(stats.totalAmountBurned)}</p>
      </div>
      <div class="stat">
        <h4>Unique Burners</h4>
        <p>${stats.uniqueBurners.toLocaleString()}</p>
      </div>
      <div class="stat">
        <h4>Unique Tokens</h4>
        <p>${stats.uniqueTokens.toLocaleString()}</p>
      </div>
    </div>
  `;
}
```

### Token-Specific Page

```javascript
// Fetch burns for a specific token
async function fetchTokenBurns(tokenAddress) {
  const certIds = await contract.get_token_certificates({
    token_address: tokenAddress
  });
  
  const certificates = await Promise.all(
    certIds.map(id => contract.get_certificate({ certificate_id: id }))
  );
  
  const totalBurned = await contract.get_total_burned({
    token_address: tokenAddress
  });
  
  return {
    certificates,
    totalBurned
  };
}
```

## Events

The contract emits the following events:

- `burn_rec`: Burn recorded
- `cert_vrf`: Certificate verified
- `cert_rev`: Certificate revoked
- `ver_add`: Verifier added
- `ver_rem`: Verifier removed

## Use Cases

### 1. Deflationary Tokens

```rust
// Regular deflationary burns
contract.record_burn(
    burner,
    token,
    amount,
    BurnReason::Deflationary,
    tx_hash,
    String::from_str(&env, r#"{"campaign":"monthly_burn"}"#)
);
```

### 2. Cross-Chain Bridges

```rust
// Burn for bridging to another chain
contract.record_burn(
    burner,
    token,
    amount,
    BurnReason::CrossChainBridge,
    tx_hash,
    String::from_str(&env, r#"{"dest_chain":"ethereum","dest_address":"0x..."}"#)
);
```

### 3. Token Upgrades

```rust
// Burn old tokens for upgrade
contract.record_burn(
    burner,
    old_token,
    amount,
    BurnReason::Upgrade,
    tx_hash,
    String::from_str(&env, r#"{"new_token":"C...","version":"2.0"}"#)
);
```

### 4. Governance Burns

```rust
// Burn based on governance decision
contract.record_burn(
    burner,
    token,
    amount,
    BurnReason::Governance,
    tx_hash,
    String::from_str(&env, r#"{"proposal_id":"42","vote_result":"approved"}"#)
);
```

## Testing

Run tests with:
```bash
cargo test -p soromint-proof-of-burn
```

## Security Considerations

### Certificate Integrity

- Certificates are immutable once created
- Only status can be updated (verified/revoked)
- Transaction hashes provide on-chain verification

### Verification

- Only authorized verifiers can verify certificates
- Verification adds credibility but is optional
- Consider multi-verifier requirements for high-value burns

### Revocation

- Only admin can revoke certificates
- Use revocation for fraudulent or erroneous certificates
- Consider implementing a challenge period

### Public Display

- Can be disabled for privacy
- Consider filtering sensitive metadata
- Implement rate limiting on queries

## Future Enhancements

- [ ] Multi-signature verification requirements
- [ ] Challenge period before verification
- [ ] Burn rewards/incentives
- [ ] NFT certificates for significant burns
- [ ] Integration with analytics platforms
- [ ] Automated verification via oracles
- [ ] Burn leaderboards
- [ ] Historical burn charts
- [ ] Export functionality (CSV, JSON)
- [ ] Email notifications for verified burns

## API Reference

### Read Functions

- `get_certificate(id)`: Get certificate by ID
- `get_certificate_count()`: Total number of certificates
- `get_certificates(start, limit)`: Get multiple certificates
- `get_burner_certificates(burner)`: Get all certificates for a burner
- `get_token_certificates(token)`: Get all certificates for a token
- `get_total_burned(token)`: Total amount burned for a token
- `get_burn_stats()`: Aggregate statistics
- `is_verifier(address)`: Check if address is a verifier
- `is_public_display_enabled()`: Check public display setting

### Write Functions

- `initialize(admin)`: Initialize contract
- `record_burn(...)`: Record a burn event
- `verify_certificate(verifier, id)`: Verify a certificate
- `revoke_certificate(admin, id)`: Revoke a certificate
- `add_verifier(admin, verifier)`: Add verifier
- `remove_verifier(admin, verifier)`: Remove verifier
- `set_public_display(admin, enabled)`: Set public display

## License

This contract is part of the SoroMint project.

## Related Issues

Closes #176
