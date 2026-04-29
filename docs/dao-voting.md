# DAO Voting System for Metadata Updates

## Overview
The DAO (Decentralized Autonomous Organization) voting system enables token holders to propose and vote on metadata changes for their tokens. Once a proposal reaches the required quorum, it automatically executes the metadata update on the Stellar blockchain.

## Architecture

### Models

#### Proposal Model
Stores proposals for token metadata changes.

**Fields:**
- `tokenId`: Reference to the Token being modified
- `contractId`: Stellar contract address
- `proposer`: Stellar public key of the proposer
- `type`: Type of proposal (currently only 'METADATA_UPDATE')
- `changes`: Object containing proposed changes (name, symbol)
- `status`: Current status (PENDING, ACTIVE, EXECUTED, REJECTED, EXPIRED)
- `votesFor`: Number of votes in favor
- `votesAgainst`: Number of votes against
- `quorum`: Required approval percentage (default: 51%)
- `expiresAt`: Proposal expiration date
- `executedAt`: Timestamp of execution
- `executionTxHash`: Stellar transaction hash of execution

#### Vote Model
Tracks individual votes on proposals.

**Fields:**
- `proposalId`: Reference to the Proposal
- `voter`: Stellar public key of the voter
- `support`: Boolean indicating support (true) or opposition (false)
- `weight`: Vote weight (default: 1)
- `createdAt`: Timestamp of vote

**Indexes:**
- Unique compound index on (proposalId, voter) to prevent duplicate votes

## API Endpoints

### Create Proposal
**POST** `/api/dao/proposals`

Creates a new proposal for token metadata changes.

**Request Body:**
```json
{
  "tokenId": "507f1f77bcf86cd799439011",
  "contractId": "CTEST123...",
  "proposer": "GPROPOSER123...",
  "changes": {
    "name": "New Token Name",
    "symbol": "NEW"
  },
  "quorum": 60,
  "durationDays": 7
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "_id": "507f1f77bcf86cd799439012",
    "tokenId": "507f1f77bcf86cd799439011",
    "status": "ACTIVE",
    "votesFor": 0,
    "votesAgainst": 0,
    "expiresAt": "2024-04-15T00:00:00.000Z"
  }
}
```

### Cast Vote
**POST** `/api/dao/votes`

Cast a vote on an active proposal.

**Request Body:**
```json
{
  "proposalId": "507f1f77bcf86cd799439012",
  "voter": "GVOTER123...",
  "support": true
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "_id": "507f1f77bcf86cd799439013",
    "proposalId": "507f1f77bcf86cd799439012",
    "voter": "GVOTER123...",
    "support": true,
    "weight": 1
  }
}
```

### Get Proposal
**GET** `/api/dao/proposals/:proposalId`

Retrieve a specific proposal by ID.

**Response:**
```json
{
  "success": true,
  "data": {
    "_id": "507f1f77bcf86cd799439012",
    "tokenId": {...},
    "status": "ACTIVE",
    "votesFor": 5,
    "votesAgainst": 2,
    "quorum": 60
  }
}
```

### Get Proposals by Token
**GET** `/api/dao/proposals?tokenId=:tokenId&status=ACTIVE`

Retrieve all proposals for a specific token, optionally filtered by status.

**Query Parameters:**
- `tokenId` (required): MongoDB ObjectId of the token
- `status` (optional): Filter by status (PENDING, ACTIVE, EXECUTED, REJECTED, EXPIRED)

### Get Votes for Proposal
**GET** `/api/dao/proposals/:proposalId/votes`

Retrieve all votes for a specific proposal.

## Voting Logic

### Proposal Lifecycle

1. **Creation**: Proposal is created with status 'ACTIVE'
2. **Voting Period**: Users can cast votes until expiration
3. **Quorum Check**: After each vote, system checks if quorum is reached
4. **Execution**: If quorum is met and minimum votes (3) are cast, proposal auto-executes
5. **Expiration**: Proposals expire after the specified duration

### Quorum Calculation

```javascript
approvalRate = (votesFor / totalVotes) * 100
```

A proposal executes when:
- `approvalRate >= quorum` (e.g., 60%)
- `totalVotes >= 3` (minimum participation)

### Execution Process

1. Validates proposal status is 'ACTIVE'
2. Retrieves token and contract details
3. Builds Stellar transaction with metadata update operations
4. Simulates transaction on Stellar network
5. Updates proposal status to 'EXECUTED'
6. Updates token metadata in database
7. Logs execution transaction hash

## Security Features

### Validation
- All inputs validated using express-validator
- MongoDB ObjectId validation for IDs
- String length limits for metadata fields
- Quorum range validation (1-100%)
- Duration range validation (1-30 days)

### Authentication
- All endpoints require JWT authentication
- Voter identity verified through Stellar public key

### Duplicate Prevention
- Unique compound index prevents duplicate votes
- Database-level constraint enforcement

### Error Handling
- Comprehensive error messages
- Proper HTTP status codes
- Detailed logging for debugging

## Usage Example

### 1. Create a Proposal
```bash
curl -X POST http://localhost:5000/api/dao/proposals \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "tokenId": "507f1f77bcf86cd799439011",
    "contractId": "CTEST123...",
    "proposer": "GPROPOSER123...",
    "changes": {
      "name": "Updated Token Name"
    },
    "quorum": 51,
    "durationDays": 7
  }'
```

### 2. Cast Votes
```bash
# Vote in favor
curl -X POST http://localhost:5000/api/dao/votes \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "proposalId": "507f1f77bcf86cd799439012",
    "voter": "GVOTER1...",
    "support": true
  }'

# Vote against
curl -X POST http://localhost:5000/api/dao/votes \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "proposalId": "507f1f77bcf86cd799439012",
    "voter": "GVOTER2...",
    "support": false
  }'
```

### 3. Check Proposal Status
```bash
curl -X GET http://localhost:5000/api/dao/proposals/507f1f77bcf86cd799439012 \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

## Testing

Run the test suite:
```bash
cd server
npm test -- dao-service.test.js
```

## Future Enhancements

1. **Weighted Voting**: Vote weight based on token holdings
2. **Delegation**: Allow users to delegate voting power
3. **Multiple Proposal Types**: Support for parameter changes, upgrades, etc.
4. **Time-locked Execution**: Delay between approval and execution
5. **Proposal Cancellation**: Allow proposer to cancel before execution
6. **Vote Changes**: Allow voters to change their vote before expiration
7. **Notification System**: Alert users of new proposals and outcomes

## Error Codes

- `TOKEN_NOT_FOUND`: Token does not exist
- `PROPOSAL_NOT_FOUND`: Proposal does not exist
- `PROPOSAL_NOT_ACTIVE`: Proposal is not in active state
- `PROPOSAL_EXPIRED`: Proposal voting period has ended
- `ALREADY_VOTED`: User has already voted on this proposal
- `INVALID_STATUS`: Proposal status prevents requested action
- `VALIDATION_ERROR`: Input validation failed

## Logging

All DAO operations are logged with correlation IDs for tracing:
- Proposal creation
- Vote casting
- Proposal execution
- Execution failures

Check logs for debugging:
```bash
tail -f server/logs/combined.log
```
