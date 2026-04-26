# Redis Caching Layer for Token Metadata

## Overview

The Redis caching layer reduces database load and improves API response times by caching frequently accessed token metadata. This implementation uses a **cache-aside pattern** where the application checks the cache before querying the database.

## Features

- ✅ **Cache-Aside Pattern**: Check cache first, fetch from DB if miss, then cache result
- ✅ **Automatic TTL Expiration**: Configurable time-to-live for cached data
- ✅ **Cache Invalidation**: Automatic invalidation when token metadata is updated
- ✅ **Graceful Degradation**: Application continues to work if Redis is unavailable
- ✅ **Pattern-Based Deletion**: Efficient cache cleanup using key patterns
- ✅ **Health Checks**: Monitor Redis connection and cache service health
- ✅ **Comprehensive Logging**: Detailed logs for cache operations and debugging

## Architecture

### Cache Service (`services/cache-service.js`)

The `CacheService` class provides a singleton instance for managing all cache operations:

```javascript
const { getCacheService } = require("./services/cache-service");

const cacheService = getCacheService();

// Get from cache (returns null if not found)
const cached = await cacheService.get("my:key");

// Set value with TTL (default: CACHE_TTL_METADATA from env config)
await cacheService.set("my:key", data, 3600);

// Delete single key
await cacheService.delete("my:key");

// Delete keys matching a pattern
await cacheService.deleteByPattern("tokens:owner:GUSER123:*");

// Cache-aside pattern (get or set)
const result = await cacheService.getOrSet(
  "key",
  async () => {
    return await expensiveQuery();
  },
  { ttl: 7200 },
);

// Check health
const health = await cacheService.getHealth();
```

### Token Routes Integration

The token list endpoint (`routes/token-routes.js`) implements caching:

```javascript
// GET /api/tokens/:owner
// Cache key: tokens:owner:{owner}:page:{page}:limit:{limit}:search:{search}

// Response includes:
{
  "success": true,
  "data": [...tokens],
  "metadata": {...},
  "cached": true/false  // Indicates if result came from cache
}
```

**Cache Invalidation**: When a new token is created, all cache entries for that owner are invalidated:

```javascript
// After POST /api/tokens
await cacheService.deleteByPattern(`tokens:owner:${ownerPublicKey}:*`);
```

## Configuration

### Environment Variables

Add these to your `.env` file (see `.env.example.redis` for reference):

```bash
# Redis connection URL
REDIS_URL=redis://localhost:6379

# Optional: Redis password
REDIS_PASSWORD=YOUR_REDIS_PASSWORD_HERE

# Redis database number (0-15)
REDIS_DB=0

# Cache TTL for token metadata (in seconds)
CACHE_TTL_METADATA=3600  # 1 hour
```

### Development Setup

**Local Development with Docker:**

```bash
# Run Redis on port 6379
docker run -d -p 6379:6379 redis:latest

# Or with password protection:
docker run -d -p 6379:6379 redis:latest redis-server --requirepass yourpassword
```

**Using Docker Compose:**

Add to `docker-compose.yml`:

```yaml
cache:
  image: redis:latest
  ports:
    - "6379:6379"
  environment:
    - REDIS_PASSWORD=${REDIS_PASSWORD}
  healthcheck:
    test: ["CMD", "redis-cli", "ping"]
    interval: 5s
    timeout: 3s
    retries: 5
```

**Environment Setup for Different Environments:**

```bash
# Development (lightweight caching)
REDIS_URL=redis://localhost:6379
CACHE_TTL_METADATA=1800  # 30 minutes

# Production (aggressive caching)
REDIS_URL=redis://USER:PASSWORD@HOST:PORT
CACHE_TTL_METADATA=3600  # 1 hour

# Test (minimal caching)
REDIS_URL=redis://localhost:6379
CACHE_TTL_METADATA=300  # 5 minutes
```

## Cache Strategy

### When Cache is Used

1. **Token Listing** (`GET /api/tokens/:owner`):
   - Cached by: Owner, page, limit, and search query
   - TTL: `CACHE_TTL_METADATA` (default 1 hour)
   - Ideal for: Users viewing their token lists repeatedly

### When Cache is Invalidated

1. **Token Creation** (`POST /api/tokens`):
   - Clears all cache entries for the token owner
   - Pattern: `tokens:owner:{ownerPublicKey}:*`
   - Ensures fresh data on next query

### TTL Strategy

Adjust `CACHE_TTL_METADATA` based on your needs:

| TTL               | Use Case               | Pros             | Cons                |
| ----------------- | ---------------------- | ---------------- | ------------------- |
| **300s (5min)**   | High-frequency updates | Fresh data       | More DB hits        |
| **1800s (30min)** | Standard apps          | Good balance     | Moderate staleness  |
| **3600s (1h)**    | Read-heavy apps        | Best performance | Potential staleness |
| **7200s (2h)**    | Static metadata        | Minimal DB load  | More stale data     |

## Monitoring & Health Checks

### Cache Service Health

```javascript
const cacheService = getCacheService();

// Check if healthy
const isHealthy = cacheService.isHealthy();

// Get detailed health info
const health = await cacheService.getHealth();
// Returns: { status: 'healthy'|'unhealthy'|'disconnected', connected: boolean, ... }
```

### Logging

The cache service logs all operations:

- **INFO**: Connection established, service initialized
- **DEBUG**: Cache hits, misses, and operations
- **WARN**: Connection issues, failed operations
- **ERROR**: Critical failures

View logs:

```bash
tail -f logs/application.log | grep -i cache
```

## Performance Optimization

### Example Metrics

With typical token metadata queries:

- **Without Cache**: ~100-200ms per request (DB query + network)
- **With Cache (Hit)**: ~1-5ms per request (Redis lookup)
- **Improvement**: 20-200x faster for cache hits

### Best Practices

1. **Set Appropriate TTL**: Balance freshness vs. performance
2. **Monitor Cache Hit Rate**: Track `cached: true` in API responses
3. **Use Pattern Deletion**: More efficient than deleting individual keys
4. **Handle Graceful Degradation**: App works without Redis
5. **Test Cache Invalidation**: Ensure data updates are reflected

## Troubleshooting

### Redis Connection Fails

```
Error: Redis max retries reached
```

**Solution:**

```bash
# Check if Redis is running
redis-cli ping
# Expected: PONG

# Check network connectivity
telnet localhost 6379

# Verify REDIS_URL in .env
echo $REDIS_URL
```

### Cache Not Working

**Enable debug logging:**

```javascript
// In cache-service.js, the logger.debug calls will show detailed info
# Check logs for "Cache hit" or "Cache miss"
tail -f logs/application.log | grep -E "Cache (hit|miss|set|invalidated)"
```

**Clear cache manually:**

```bash
# Connect to Redis CLI
redis-cli

# Flush all data from current database
> FLUSHDB

# Or specific pattern
> DEL tokens:owner:GUSER123:*
```

### High Memory Usage

**Solution:**

- Reduce `CACHE_TTL_METADATA` value
- Use Redis memory optimization settings:
  ```bash
  redis-cli CONFIG SET maxmemory 256mb
  redis-cli CONFIG SET maxmemory-policy allkeys-lru
  ```

## Testing

### Run Cache Service Tests

```bash
npm test -- tests/services/cache-service.test.js
```

### Run Token Routes Cache Tests

```bash
npm test -- tests/routes/token-routes-cache.test.js
```

### Integration Testing

Tests verify:

- ✅ Cache hits return expected data
- ✅ Cache misses fetch from database
- ✅ Cache invalidation on token creation
- ✅ Graceful degradation on Redis failure
- ✅ Correct cache key generation
- ✅ TTL configuration

## Future Enhancements

Potential improvements:

1. **Cache Warming**: Pre-populate cache on server startup
2. **Cache Analytics**: Track hit rates and performance
3. **Distributed Caching**: Support Redis Cluster
4. **Cache Compression**: Compress large cached values
5. **Selective Invalidation**: Fine-grained cache updates
6. **Cache Versioning**: Support schema migrations
7. **Metrics Export**: Prometheus metrics for monitoring

## API Response Example

```json
{
  "success": true,
  "data": [
    {
      "_id": "507f1f77bcf86cd799439011",
      "name": "Gold Token",
      "symbol": "GLD",
      "decimals": 7,
      "contractId": "CA1234...",
      "ownerPublicKey": "GUSER123...",
      "createdAt": "2026-03-30T12:00:00Z"
    }
  ],
  "metadata": {
    "totalCount": 15,
    "page": 1,
    "totalPages": 1,
    "limit": 20,
    "search": null
  },
  "cached": true
}
```

## References

- [Redis Documentation](https://redis.io/docs/)
- [Node Redis Client](https://github.com/redis/node-redis)
- [Cache-Aside Pattern](https://docs.microsoft.com/en-us/azure/architecture/patterns/cache-aside)
