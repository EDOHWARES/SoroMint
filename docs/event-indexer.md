# Soroban Event Indexer

## Overview
High-throughput microservice that indexes Soroban smart contract events in real-time from the Stellar network and stores them in MongoDB for rapid retrieval.

## Architecture

### Components
1. **Event Indexer Worker** (`event-indexer-worker.js`) - Standalone microservice
2. **Event Indexer Service** (`services/event-indexer.js`) - Core indexing logic
3. **SorobanEvent Model** (`models/SorobanEvent.js`) - MongoDB schema with optimized indexes
4. **API Routes** (`routes/soroban-event-routes.js`) - Query endpoints

### Data Flow
```
Soroban RPC → Event Indexer → MongoDB → API → Client
```

## Features

### High-Throughput Indexing
- Batch processing (100 events per poll)
- Cursor-based pagination for resumable indexing
- Automatic reconnection with exponential backoff
- Duplicate detection via unique paging tokens

### Optimized Storage
- Compound indexes for fast queries:
  - `contractId + ledger`
  - `eventType + ledgerClosedAt`
  - `contractId + eventType + ledgerClosedAt`
- Automatic timestamp tracking

### Query API
- Filter by contract, event type, ledger range
- Pagination support
- Aggregated statistics

## Usage

### Running the Indexer

**Development:**
```bash
cd server
npm run indexer:dev
```

**Production:**
```bash
npm run indexer
```

**Docker:**
```bash
docker-compose up event-indexer
```

### API Endpoints

**GET /api/soroban/events**
Query indexed events with filters:
```bash
curl -H "Authorization: Bearer <token>" \
  "http://localhost:5000/api/soroban/events?contractId=CA...&page=1&limit=50"
```

Query parameters:
- `contractId` - Filter by contract address
- `eventType` - Filter by event type
- `startLedger` - Minimum ledger number
- `endLedger` - Maximum ledger number
- `page` - Page number (default: 1)
- `limit` - Results per page (default: 50)

**GET /api/soroban/events/stats**
Get aggregated event statistics:
```bash
curl -H "Authorization: Bearer <token>" \
  "http://localhost:5000/api/soroban/events/stats"
```

## Configuration

Add to `.env`:
```env
SOROBAN_RPC_URL=https://soroban-testnet.stellar.org
MONGO_URI=mongodb://localhost:27017/soromint
```

## Performance

### Indexing Rate
- ~100 events per 5 seconds
- ~1,200 events per minute
- ~72,000 events per hour

### Query Performance
- Indexed queries: <50ms
- Aggregations: <200ms
- Pagination: O(1) with cursor

## Monitoring

Check indexer logs:
```bash
docker logs -f soromint-event-indexer
```

Monitor MongoDB indexes:
```javascript
db.sorobanevents.getIndexes()
db.sorobanevents.stats()
```

## Scaling

### Horizontal Scaling
Run multiple indexers with different contract filters:
```javascript
// Indexer 1: Token contracts
filters: [{ contractIds: ['CA...', 'CB...'] }]

// Indexer 2: DAO contracts  
filters: [{ contractIds: ['CC...', 'CD...'] }]
```

### Vertical Scaling
- Increase `BATCH_SIZE` for higher throughput
- Decrease `POLL_INTERVAL_MS` for lower latency
- Add MongoDB read replicas for query scaling

## Troubleshooting

**Indexer not starting:**
- Check `SOROBAN_RPC_URL` is accessible
- Verify MongoDB connection
- Check logs for errors

**Missing events:**
- Indexer resumes from last cursor automatically
- Check `lastCursor` in logs
- Verify RPC endpoint is synced

**Slow queries:**
- Ensure indexes are created: `db.sorobanevents.getIndexes()`
- Use compound index queries
- Add pagination to large result sets



