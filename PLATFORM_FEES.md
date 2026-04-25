# Platform Fee Tracking Implementation

This document describes the platform fee tracking system implemented for the SoroMint streaming service.

## Overview

The platform fee tracking system automatically calculates, tracks, and manages fees collected during stream creation. It provides:

- Automatic fee calculation during stream creation
- Configurable fee percentages per token
- Database tracking of collected and withdrawn fees
- Admin endpoints for fee management and withdrawal

## Architecture

### Components

1. **PlatformFee Model** - Tracks individual fee records
2. **PlatformFeeConfig Model** - Manages fee configurations per token
3. **PlatformFeeService** - Business logic for fee calculation and management
4. **Admin Routes** - Endpoints for fee management
5. **Streaming Integration** - Fee calculation during stream creation

### Database Schema

#### PlatformFee Collection
- `streamId` - Reference to the stream
- `feeAmount` - Amount of fee collected
- `feePercentage` - Percentage used for calculation
- `tokenAddress` - Token contract address
- `status` - collected/withdrawn/pending
- `collectionTxHash` - Transaction hash of stream creation

#### PlatformFeeConfig
- `tokenAddress` - Token contract address
- `feePercentage` - Fee percentage for this token
- `isActive` - Whether this configuration is active
- `minFeeAmount` - Minimum fee amount (optional)
- `maxFeeAmount` - Maximum fee amount (optional)

## API Endpoints

### Admin Endpoints

#### Fee Management
- `GET /api/admin/fees` - Get collected fees with optional filtering
- `GET /api/admin/fees/stats` - Get fee statistics by token
- `GET /api/admin/fees/withdrawals` - Get withdrawal history

#### Fee Configuration
- `GET /api/admin/fee-configs` - Get all fee configurations
- `POST /api/admin/fee-configs` - Create/update fee configuration
- `PATCH /api/admin/fee-configs/:tokenAddress/toggle` - Toggle configuration active status
- `DELETE /api/admin/fee-configs/:tokenAddress` - Delete fee configuration

#### Fee Withdrawal
- `POST /api/admin/fees/withdraw` - Withdraw collected fees

### Streaming Integration

The platform fee is automatically calculated and tracked during stream creation:

```javascript
POST /api/streaming/streams
{
  "sender": "...",
  "recipient": "...",
  "tokenAddress": "...",
  "totalAmount": "1000000000",
  "startLedger": 1000,
  "stopLedger": 2000
}

Response includes:
{
  "success": true,
  "streamId": "...",
  "txHash": "...",
  "platformFee": {
    "amount": "10000000",  // 1% fee
    "percentage": 0.01
  }
}
```

## Configuration

### Environment Variables

```env
PLATFORM_FEE_PERCENTAGE=0.01  # Default 1% platform fee
ADMIN_API_KEY=your-admin-api-key
STREAMING_CONTRACT_ID=your-contract-address
```

### Fee Configuration

Create custom fee configurations per token:

```javascript
POST /api/admin/fee-configs
{
  "tokenAddress": "0x123...",
  "feePercentage": 0.02,  // 2% fee
  "updatedBy": "admin-address",
  "description": "Higher fee for premium token",
  "minFeeAmount": "1000000",  // Minimum fee
  "maxFeeAmount": "100000000" // Maximum fee
}
```

## Fee Calculation Logic

1. **Default Fee**: Uses `PLATFORM_FEE_PERCENTAGE` environment variable (default 1%)
2. **Token-Specific**: Uses configured percentage for the token if available
3. **Constraints**: Applies minimum/maximum fee constraints if configured
4. **Precision**: Uses BigInt for accurate calculations with large numbers

## Security

- Admin endpoints require `X-Admin-Key` header with valid API key
- All fee operations are logged and auditable
- Fee withdrawals require admin authentication
- Database records maintain full transaction history

## Migration

Run the database migrations to create the required tables:

```bash
npm run migrate
```

This will create:
- `platform_fees` table for fee tracking
- `platform_fee_configs` table for fee configurations

## Testing

Run the platform fee service tests:

```bash
npm test -- tests/platform-fee-service.test.js
```

## Acceptance Criteria

✅ **Fees are accurately calculated during stream creation**
✅ **Fee payouts are tracked in the database**
✅ **Admin endpoint exists for fee withdrawal**
✅ **Fees are manageable through configuration**
✅ **Database migrations are provided**
✅ **Comprehensive test coverage**

## Usage Example

1. **Configure fee for a token**:
   ```bash
   curl -X POST http://localhost:5000/api/admin/fee-configs \
     -H "Content-Type: application/json" \
     -H "X-Admin-Key: your-api-key" \
     -d '{
       "tokenAddress": "0xabc...",
       "feePercentage": 0.015,
       "updatedBy": "admin-address"
     }'
   ```

2. **Create a stream** (fee automatically calculated):
   ```bash
   curl -X POST http://localhost:5000/api/streaming/streams \
     -H "Content-Type: application/json" \
     -d '{
       "sender": "0xsender...",
       "recipient": "0xrecipient...",
       "tokenAddress": "0xabc...",
       "totalAmount": "1000000000",
       "startLedger": 1000,
       "stopLedger": 2000
     }'
   ```

3. **Withdraw collected fees**:
   ```bash
   curl -X POST http://localhost:5000/api/admin/fees/withdraw \
     -H "Content-Type: application/json" \
     -H "X-Admin-Key: your-api-key" \
     -d '{
       "tokenAddress": "0xabc...",
       "adminAddress": "0xadmin..."
     }'
   ```

The platform fee tracking system is now fully operational and meets all acceptance criteria.
