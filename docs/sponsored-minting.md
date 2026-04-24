# Sponsored Minting System

## Overview

The Sponsored Minting System is a feature of the Delegated Minting System that allows a designated sponsor address to cover protocol fees on behalf of a token owner. This enables use cases where:

- Organizations want to subsidize minting costs for users
- Protocols want to offer fee-free minting to partners
- Treasuries want to absorb operational costs
- Incentive programs want to reduce friction for participants

## How It Works

### Traditional Minting Flow
```
Owner → Mint → Fee deducted from owner → Tokens to recipient
```

### Sponsored Minting Flow
```
Owner → Delegate Mint → Fee deducted from sponsor → Tokens to recipient
```

## Configuration

### Setting Up Sponsored Delegation

**Step 1: Ensure Sponsor Has Tokens**
```bash
# Transfer tokens to sponsor address
POST /api/token/transfer
{
  "from": "G...",
  "to": "G...", // sponsor address
  "amount": "10000000000" // 10,000 tokens for fees
}
```

**Step 2: Approve Delegation with Sponsor**
```bash
POST /api/delegation/approve
{
  "tokenContractId": "C...",
  "owner": "G...",
  "delegate": "G...",
  "limit": "1000000000", // 1000 tokens
  "sponsor": "G..." // sponsor address
}
```

### Fee Calculation

Fees are calculated based on the token's fee configuration:

```
Fee = Mint Amount × Fee BPS / 10000

Example:
- Mint Amount: 100 tokens
- Fee BPS: 500 (5%)
- Fee: 100 × 500 / 10000 = 5 tokens
```

### Sponsor Balance Requirements

Before executing a delegated mint with a sponsor:

```bash
POST /api/delegation/can-mint
{
  "tokenContractId": "C...",
  "owner": "G...",
  "delegate": "G...",
  "amount": "100000000"
}
```

Response:
```json
{
  "success": true,
  "data": {
    "canMint": true
  }
}
```

If sponsor doesn't have sufficient balance:
```json
{
  "success": false,
  "error": "sponsor has insufficient balance to cover fee"
}
```

## Use Cases

### 1. Organization Subsidizing User Minting

**Scenario**: A DAO wants to mint governance tokens for new members without charging them fees.

**Setup**:
```javascript
// DAO treasury is the sponsor
const sponsor = "G..."; // DAO treasury address
const owner = "G...";   // New member
const delegate = "G..."; // Minting service

// Approve delegation with DAO as sponsor
await delegationService.approveMinter(
  tokenContractId,
  owner,
  delegate,
  BigInt("1000000000"), // 1000 tokens
  sponsor
);

// Execute mint - DAO pays the fee
await delegationService.delegateMint(
  tokenContractId,
  delegate,
  owner,
  owner, // recipient
  BigInt("100000000") // 100 tokens
);
```

### 2. Protocol Incentive Program

**Scenario**: A protocol wants to offer fee-free minting to early adopters.

**Setup**:
```javascript
// Protocol treasury covers fees
const sponsor = "G..."; // Protocol treasury
const owner = "G...";   // Early adopter
const delegate = "G..."; // Minting bot

// Approve with protocol as sponsor
await delegationService.approveMinter(
  tokenContractId,
  owner,
  delegate,
  BigInt("10000000000"), // 10,000 tokens
  sponsor
);

// Users can mint without paying fees
await delegationService.delegateMint(
  tokenContractId,
  delegate,
  owner,
  owner,
  BigInt("1000000000") // 1000 tokens
);
```

### 3. Multi-Tier Sponsorship

**Scenario**: Different sponsors for different delegation tiers.

**Setup**:
```javascript
// Tier 1: Premium users (sponsor covers 100% of fees)
await delegationService.approveMinter(
  tokenContractId,
  premiumUser,
  delegate,
  BigInt("10000000000"),
  premiumSponsor // Premium sponsor
);

// Tier 2: Standard users (sponsor covers 50% of fees)
// Note: This requires custom implementation
// For now, users can pay their own fees
await delegationService.approveMinter(
  tokenContractId,
  standardUser,
  delegate,
  BigInt("1000000000"),
  null // No sponsor - user pays fees
);
```

## Fee Sponsorship Mechanics

### On-Chain Fee Deduction

When `delegate_mint()` is called with a sponsor:

```rust
if let Some(ref sponsor) = entry.sponsor {
    if let Some(fee_config) = e.storage().instance().get::<_, FeeConfig>(&DataKey::FeeConfig) {
        if fee_config.enabled && fee_config.fee_bps > 0 {
            // Calculate fee
            let fee_amount = amount
                .checked_mul(fee_config.fee_bps as i128).unwrap()
                .checked_div(10000).unwrap();
            
            if fee_amount > 0 {
                // Deduct from sponsor
                let sponsor_bal = Self::read_balance(&e, sponsor);
                if sponsor_bal < fee_amount {
                    panic!("sponsor has insufficient balance to cover fee");
                }
                Self::write_balance(&e, sponsor, sponsor_bal - fee_amount);
                
                // Credit treasury
                let treasury_bal = Self::read_balance(&e, &fee_config.treasury);
                Self::write_balance(&e, &fee_config.treasury, treasury_bal + fee_amount);
                
                // Emit event
                events::emit_fee_collected(&e, sponsor, &fee_config.treasury, fee_amount);
                
                // Mint full amount to recipient
                let mut balance = Self::read_balance(&e, &to);
                balance += amount;
                Self::write_balance(&e, &to, balance);
            }
        }
    }
}
```

### Balance Changes

**Before Mint:**
```
Owner Balance:    1000 tokens
Sponsor Balance:  5000 tokens
Treasury Balance: 100 tokens
Recipient Balance: 0 tokens
```

**After Delegated Mint (100 tokens, 5% fee):**
```
Owner Balance:    1000 tokens (unchanged)
Sponsor Balance:  4995 tokens (5 tokens fee deducted)
Treasury Balance: 105 tokens (5 tokens fee added)
Recipient Balance: 100 tokens (full amount received)
```

## Monitoring Sponsor Activity

### Get Sponsor Statistics

```bash
GET /api/delegation/stats/C...
```

Response includes:
```json
{
  "delegationsWithSponsor": 42,
  "totalLimitBN": "1000000000000",
  "totalMintedBN": "500000000000"
}
```

### Track Sponsor Fees

```bash
GET /api/delegation/delegate/C.../G... // sponsor address
```

Returns all delegations where this address is a sponsor.

### Monitor Sponsor Balance

```bash
GET /api/token/balance/G... // sponsor address
```

Ensure sponsor maintains sufficient balance for upcoming mints.

## Best Practices

### For Sponsors

1. **Maintain Buffer**: Keep extra tokens for unexpected fee spikes
   ```
   Required Balance = Expected Mints × Average Fee
   Buffer = Required Balance × 1.5
   ```

2. **Monitor Delegations**: Regularly check active delegations
   ```bash
   GET /api/delegation/delegate/C.../G...
   ```

3. **Set Spending Limits**: Use delegation limits to control exposure
   ```javascript
   // Limit sponsor exposure to 1000 tokens of fees
   const limit = BigInt("20000000000"); // 20,000 tokens at 5% fee
   ```

4. **Audit Trail**: Review fee collection events
   ```bash
   GET /api/delegation/stats/C...
   ```

### For Owners

1. **Verify Sponsor**: Confirm sponsor address before accepting delegation
   ```bash
   GET /api/delegation/C.../G.../G...
   ```

2. **Monitor Limit**: Track remaining minting capacity
   ```javascript
   const delegation = await delegationService.getDelegation(
     tokenContractId,
     owner,
     delegate
   );
   const remaining = delegation.offChain.getRemainingLimit();
   ```

3. **Request Renewal**: Ask sponsor to increase limit if needed
   ```javascript
   // Revoke old delegation
   await delegationService.revokeMinter(tokenContractId, owner, delegate);
   
   // Approve new delegation with higher limit
   await delegationService.approveMinter(
     tokenContractId,
     owner,
     delegate,
     BigInt("2000000000"), // Higher limit
     sponsor
   );
   ```

### For Delegates

1. **Check Sponsor Balance**: Before executing mint
   ```bash
   POST /api/delegation/can-mint
   {
     "tokenContractId": "C...",
     "owner": "G...",
     "delegate": "G...",
     "amount": "100000000"
   }
   ```

2. **Handle Failures**: Gracefully handle insufficient sponsor balance
   ```javascript
   try {
     await delegationService.delegateMint(...);
   } catch (error) {
     if (error.message.includes("insufficient balance")) {
       // Notify sponsor to top up
       // Or retry with smaller amount
     }
   }
   ```

3. **Batch Operations**: Optimize fee collection
   ```javascript
   // Batch multiple mints to reduce transaction overhead
   const mints = [
     { to: "G...", amount: "100000000" },
     { to: "G...", amount: "200000000" },
     { to: "G...", amount: "150000000" }
   ];
   ```

## Fee Configuration

### Setting Token Fee Rate

```bash
POST /api/token/set-fee-config
{
  "tokenContractId": "C...",
  "enabled": true,
  "fee_bps": 500, // 5%
  "treasury": "G..." // Treasury address
}
```

### Fee Caps

- Maximum fee: 10% (1000 bps)
- Minimum fee: 0% (0 bps)
- Fee is hard-capped at contract level

### Fee Scenarios

| Mint Amount | Fee Rate | Fee Amount | Recipient Gets |
|------------|----------|-----------|-----------------|
| 100        | 0%       | 0         | 100             |
| 100        | 1%       | 1         | 100             |
| 100        | 5%       | 5         | 100             |
| 100        | 10%      | 10        | 100             |
| 1000       | 5%       | 50        | 1000            |

## Troubleshooting

### "sponsor has insufficient balance to cover fee"

**Cause**: Sponsor doesn't have enough tokens for the fee.

**Solution**:
```bash
# Check sponsor balance
GET /api/token/balance/G...

# Transfer tokens to sponsor
POST /api/token/transfer
{
  "from": "G...",
  "to": "G...", // sponsor
  "amount": "1000000000"
}
```

### Sponsor Balance Depleted

**Cause**: Multiple mints exhausted sponsor balance.

**Solution**:
```bash
# Revoke delegation temporarily
POST /api/delegation/revoke
{
  "tokenContractId": "C...",
  "owner": "G...",
  "delegate": "G..."
}

# Sponsor tops up balance
# Re-approve delegation
POST /api/delegation/approve
{
  "tokenContractId": "C...",
  "owner": "G...",
  "delegate": "G...",
  "limit": "1000000000",
  "sponsor": "G..."
}
```

### Fee Calculation Mismatch

**Cause**: Fee calculation differs from expected.

**Solution**:
```javascript
// Verify fee configuration
const feeConfig = await tokenService.getFeeConfig(tokenContractId);

// Calculate expected fee
const fee = (amount * feeConfig.fee_bps) / 10000;

// Compare with actual fee from event
```

## Integration Examples

### Example 1: DAO Onboarding

```javascript
// DAO wants to mint governance tokens for new members
const daoTreasury = "G...";
const newMember = "G...";
const mintingService = "G...";

// Step 1: Approve delegation with DAO as sponsor
await delegationService.approveMinter(
  tokenContractId,
  newMember,
  mintingService,
  BigInt("1000000000"), // 1000 tokens
  daoTreasury // DAO pays fees
);

// Step 2: Mint tokens for new member
await delegationService.delegateMint(
  tokenContractId,
  mintingService,
  newMember,
  newMember, // recipient
  BigInt("100000000") // 100 tokens
);

// Result: New member gets 100 tokens, DAO pays 5 token fee
```

### Example 2: Incentive Program

```javascript
// Protocol wants to offer fee-free minting to early adopters
const protocolTreasury = "G...";
const earlyAdopter = "G...";
const mintingBot = "G...";

// Approve with protocol as sponsor
await delegationService.approveMinter(
  tokenContractId,
  earlyAdopter,
  mintingBot,
  BigInt("10000000000"), // 10,000 tokens
  protocolTreasury // Protocol covers fees
);

// Early adopter can mint without paying fees
await delegationService.delegateMint(
  tokenContractId,
  mintingBot,
  earlyAdopter,
  earlyAdopter,
  BigInt("1000000000") // 1000 tokens
);

// Result: Early adopter gets 1000 tokens, protocol pays fee
```

## Security Considerations

### Sponsor Risks

1. **Balance Depletion**: Monitor sponsor balance regularly
2. **Unauthorized Mints**: Verify delegate authorization
3. **Fee Manipulation**: Ensure fee configuration is correct
4. **Delegation Abuse**: Set reasonable limits

### Mitigation Strategies

1. **Balance Monitoring**: Automated alerts for low balance
2. **Delegation Audits**: Regular review of active delegations
3. **Fee Caps**: Hard-coded maximum fee (10%)
4. **Authorization Checks**: All operations require proper auth

## Future Enhancements

1. **Partial Sponsorship**: Sponsor covers percentage of fees
2. **Time-Based Sponsorship**: Sponsor expires after period
3. **Conditional Sponsorship**: Sponsor only for specific recipients
4. **Sponsor Pools**: Multiple sponsors share fee burden
5. **Fee Rebates**: Sponsor gets rebate for high-volume mints
6. **Sponsor Tiers**: Different fee rates for different sponsors

## Support

For questions about sponsored minting:
1. Review this documentation
2. Check delegated-minting.md for general delegation info
3. Review contract events in blockchain explorer
4. Contact the SoroMint team
