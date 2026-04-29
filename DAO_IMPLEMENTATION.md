# DAO Voting Implementation - Quick Setup Guide

## What Was Implemented

A complete DAO voting system for token metadata updates with:
- Proposal creation and management
- Vote tracking with duplicate prevention
- Automatic execution when quorum is reached
- Comprehensive validation and error handling
- Full test coverage

## Files Created

### Backend Core
1. **`server/models/Proposal.js`** - Proposal data model
2. **`server/models/Vote.js`** - Vote tracking model
3. **`server/services/dao-service.js`** - Business logic for proposals and voting
4. **`server/routes/dao-routes.js`** - API endpoints
5. **`server/validators/dao-validator.js`** - Input validation

### Testing & Documentation
6. **`server/tests/services/dao-service.test.js`** - Comprehensive test suite
7. **`docs/dao-voting.md`** - Complete documentation

### Modified Files
- **`server/index.js`** - Registered DAO routes
- **`server/package.json`** - Added express-validator dependency

## Installation

```bash
cd server
npm install
```

This will install the new `express-validator` dependency.

## Database Setup

The models will auto-create collections on first use. No migrations needed.

## API Endpoints

All endpoints require JWT authentication.

### 1. Create Proposal
```
POST /api/dao/proposals
```

### 2. Cast Vote
```
POST /api/dao/votes
```

### 3. Get Proposal
```
GET /api/dao/proposals/:proposalId
```

### 4. List Proposals
```
GET /api/dao/proposals?tokenId=:tokenId&status=ACTIVE
```

### 5. Get Votes
```
GET /api/dao/proposals/:proposalId/votes
```

## Testing

Run the test suite:
```bash
npm test -- dao-service.test.js
```

## Example Usage Flow

### Step 1: Create a Proposal
```javascript
POST /api/dao/proposals
{
  "tokenId": "507f1f77bcf86cd799439011",
  "contractId": "CTEST123...",
  "proposer": "GPROPOSER123...",
  "changes": {
    "name": "New Token Name",
    "symbol": "NTN"
  },
  "quorum": 60,
  "durationDays": 7
}
```

### Step 2: Users Cast Votes
```javascript
POST /api/dao/votes
{
  "proposalId": "507f1f77bcf86cd799439012",
  "voter": "GVOTER1...",
  "support": true
}
```

### Step 3: Auto-Execution
When votes reach quorum (e.g., 60% approval with minimum 3 votes), the system:
1. Builds Stellar transaction
2. Simulates on network
3. Updates proposal status to 'EXECUTED'
4. Updates token metadata in database

## Key Features

### Automatic Execution
- Proposals execute automatically when quorum is reached
- No manual intervention needed
- Transaction simulation before execution

### Vote Protection
- Unique index prevents duplicate votes
- Expired proposals reject new votes
- Only active proposals accept votes

### Flexible Configuration
- Customizable quorum percentage (1-100%)
- Configurable voting duration (1-30 days)
- Support for name and symbol changes

### Comprehensive Validation
- MongoDB ObjectId validation
- Stellar address format validation
- Range validation for quorum and duration
- Required field validation

## Environment Variables

No new environment variables needed. Uses existing:
- `SOROBAN_RPC_URL` - For Stellar network interaction
- `NETWORK_PASSPHRASE` - For transaction building
- `JWT_SECRET` - For authentication

## Security Considerations

1. **Authentication**: All endpoints require valid JWT
2. **Duplicate Prevention**: Database-level unique constraint
3. **Input Validation**: Comprehensive validation on all inputs
4. **Error Handling**: Proper error codes and messages
5. **Logging**: All operations logged with correlation IDs

## Integration with Frontend

The frontend can integrate by:

1. **Displaying Proposals**: Fetch proposals for a token
2. **Creating Proposals**: Form to submit new proposals
3. **Voting Interface**: Buttons for support/oppose
4. **Status Tracking**: Real-time proposal status updates
5. **Vote History**: Display all votes on a proposal

## Next Steps

1. **Install Dependencies**: Run `npm install` in server directory
2. **Start Server**: Run `npm run dev`
3. **Test Endpoints**: Use Postman or curl to test
4. **Review Documentation**: Read `docs/dao-voting.md` for details
5. **Run Tests**: Execute `npm test` to verify functionality

## Troubleshooting

### Issue: express-validator not found
**Solution**: Run `npm install` to install dependencies

### Issue: Proposal not executing
**Check**:
- Quorum percentage is reached
- Minimum 3 votes are cast
- Proposal status is 'ACTIVE'
- Proposal hasn't expired

### Issue: Duplicate vote error
**Expected**: Users can only vote once per proposal

### Issue: Authentication error
**Check**: Valid JWT token in Authorization header

## Future Enhancements

Consider implementing:
- Weighted voting based on token holdings
- Vote delegation
- Proposal cancellation
- Time-locked execution
- Email notifications for proposal events

## Support

For issues or questions:
1. Check logs: `server/logs/combined.log`
2. Review documentation: `docs/dao-voting.md`
3. Run tests: `npm test -- dao-service.test.js`



