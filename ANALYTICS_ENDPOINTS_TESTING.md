# Analytics Endpoints Testing Guide

## Overview
This guide provides step-by-step instructions to test the newly implemented analytics endpoints that aggregate transfer data, holder distribution, and volume metrics for all tokens minted via the SoroMint platform.

## Prerequisites
1. Backend server running: `cd server && npm run dev`
2. MongoDB running: `docker-compose up -d`
3. Valid JWT authentication token (obtain from login endpoint)
4. Sample token data with transfer events in the database

## Endpoints Implemented

### 1. Transfer Aggregation Endpoint
**Endpoint:** `GET /api/analytics/transfers`
**Authentication:** Required (JWT)
**Description:** Aggregates transfer data for all tokens

#### Testing Steps:
```bash
# Replace YOUR_TOKEN with actual JWT
curl -X GET http://localhost:5000/api/analytics/transfers \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json"
```

#### Expected Response:
```json
{
  "success": true,
  "data": {
    "exportedAt": "2024-04-24T12:00:00.000Z",
    "summary": {
      "totalTransfers": 150,
      "totalUniqueTransferers": 45,
      "tokensWithTransfers": 8
    },
    "transfers": [
      {
        "contractId": "CA3D5KRYM6CB7OWQ6TWYRR3Z4T7GNZLKERYNZGGA5SOAOPIFY6YQGAXE",
        "tokenName": "SoroMint Token",
        "symbol": "SORO",
        "decimals": 7,
        "transferCount": 25,
        "uniqueTransferers": 12,
        "totalVolume": "5000000000",
        "lastTransferAt": "2024-04-24T10:30:00.000Z"
      }
    ]
  }
}
```

### 2. Holder Distribution Endpoint
**Endpoint:** `GET /api/analytics/holders`
**Authentication:** Required (JWT)
**Description:** Returns holder distribution data for all tokens

#### Testing Steps:
```bash
curl -X GET http://localhost:5000/api/analytics/holders \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json"
```

#### Expected Response:
```json
{
  "success": true,
  "data": {
    "exportedAt": "2024-04-24T12:00:00.000Z",
    "summary": {
      "totalUniquePlatformHolders": 89,
      "tokensWithHolders": 8,
      "averageHoldersPerToken": 11
    },
    "holders": [
      {
        "contractId": "CA3D5KRYM6CB7OWQ6TWYRR3Z4T7GNZLKERYNZGGA5SOAOPIFY6YQGAXE",
        "tokenName": "SoroMint Token",
        "symbol": "SORO",
        "decimals": 7,
        "uniqueHolders": 23,
        "topHolderCount": 10
      }
    ]
  }
}
```

### 3. Volume Metrics Endpoint
**Endpoint:** `GET /api/analytics/volume?days=30`
**Authentication:** Required (JWT)
**Query Parameters:**
- `days` (optional, default: 30): Number of days to analyze (1-365)

**Description:** Returns volume metrics for all tokens including 24h, 7d, and 30d volumes

#### Testing Steps:
```bash
# Using default 30 days
curl -X GET http://localhost:5000/api/analytics/volume \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json"

# Using custom period (7 days)
curl -X GET "http://localhost:5000/api/analytics/volume?days=7" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json"
```

#### Expected Response:
```json
{
  "success": true,
  "data": {
    "exportedAt": "2024-04-24T12:00:00.000Z",
    "period": {
      "days": 30,
      "startDate": "2024-03-25T12:00:00.000Z"
    },
    "summary": {
      "totalPlatformVolume30d": "125000000000",
      "volumeMetricsTokens": 8
    },
    "volumes": [
      {
        "contractId": "CA3D5KRYM6CB7OWQ6TWYRR3Z4T7GNZLKERYNZGGA5SOAOPIFY6YQGAXE",
        "tokenName": "SoroMint Token",
        "symbol": "SORO",
        "decimals": 7,
        "volume24h": "5000000",
        "volume7d": "35000000",
        "volume30d": "120000000",
        "dailyAverage": "4000000",
        "transferCount30d": 45,
        "avgTransferSize": "2666666"
      }
    ]
  }
}
```

### 4. Comprehensive Metrics Endpoint
**Endpoint:** `GET /api/analytics/metrics?days=30`
**Authentication:** Required (JWT)
**Query Parameters:**
- `days` (optional, default: 30): Number of days for volume analysis (1-365)

**Description:** Comprehensive token metrics combining transfers, holders, and volume data

#### Testing Steps:
```bash
# Using default 30 days
curl -X GET http://localhost:5000/api/analytics/metrics \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json"

# Using custom period (14 days)
curl -X GET "http://localhost:5000/api/analytics/metrics?days=14" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json"
```

#### Expected Response:
```json
{
  "success": true,
  "data": {
    "exportedAt": "2024-04-24T12:00:00.000Z",
    "volumePeriod": {
      "days": 30,
      "startDate": "2024-03-25T12:00:00.000Z"
    },
    "platformSummary": {
      "totalTokens": 10,
      "totalTransfers": 150,
      "totalUniqueTransferers": 45,
      "totalUniquePlatformHolders": 89,
      "totalPlatformVolume30d": "125000000000",
      "tokensWithActivity": 8
    },
    "tokens": [
      {
        "contractId": "CA3D5KRYM6CB7OWQ6TWYRR3Z4T7GNZLKERYNZGGA5SOAOPIFY6YQGAXE",
        "tokenName": "SoroMint Token",
        "symbol": "SORO",
        "decimals": 7,
        "transferCount": 25,
        "uniqueTransferers": 12,
        "totalVolume": "120000000",
        "lastTransferAt": "2024-04-24T10:30:00.000Z",
        "uniqueHolders": 23,
        "topHolderCount": 10,
        "volume24h": "5000000",
        "volume7d": "35000000",
        "volume30d": "120000000",
        "dailyAverage": "4000000",
        "transferCount30d": 45,
        "avgTransferSize": "2666666"
      }
    ]
  }
}
```

## Testing with Node.js Script

Create a test file `test-analytics.js`:

```javascript
const axios = require('axios');

const BASE_URL = 'http://localhost:5000/api';
const TOKEN = 'YOUR_JWT_TOKEN';

const headers = {
  'Authorization': `Bearer ${TOKEN}`,
  'Content-Type': 'application/json'
};

async function testEndpoints() {
  try {
    console.log('Testing Transfer Aggregation...');
    const transfers = await axios.get(`${BASE_URL}/analytics/transfers`, { headers });
    console.log('✓ Transfers:', JSON.stringify(transfers.data, null, 2));

    console.log('\nTesting Holder Distribution...');
    const holders = await axios.get(`${BASE_URL}/analytics/holders`, { headers });
    console.log('✓ Holders:', JSON.stringify(holders.data, null, 2));

    console.log('\nTesting Volume Metrics (30 days)...');
    const volume30 = await axios.get(`${BASE_URL}/analytics/volume?days=30`, { headers });
    console.log('✓ Volume (30d):', JSON.stringify(volume30.data, null, 2));

    console.log('\nTesting Volume Metrics (7 days)...');
    const volume7 = await axios.get(`${BASE_URL}/analytics/volume?days=7`, { headers });
    console.log('✓ Volume (7d):', JSON.stringify(volume7.data, null, 2));

    console.log('\nTesting Comprehensive Metrics...');
    const metrics = await axios.get(`${BASE_URL}/analytics/metrics?days=30`, { headers });
    console.log('✓ Metrics:', JSON.stringify(metrics.data, null, 2));

    console.log('\n✅ All tests passed!');
  } catch (error) {
    console.error('❌ Test failed:', error.response?.data || error.message);
  }
}

testEndpoints();
```

Run it with:
```bash
node test-analytics.js
```

## Data Validation Checklist

After running the endpoints, verify:

- [ ] All endpoints return HTTP 200 with `success: true`
- [ ] `exportedAt` timestamps are valid ISO 8601 dates
- [ ] Transfer counts are non-negative integers
- [ ] Volume values are valid big integers (as strings)
- [ ] Holder counts are non-negative integers
- [ ] Token contract IDs are present and unique per token
- [ ] All token symbols, names, and decimals match database records
- [ ] Volume metrics show logical progression: volume24h ≤ volume7d ≤ volume30d
- [ ] Average values are mathematically correct (volume divided by count)
- [ ] Last transfer dates are within the analysis period
- [ ] Platform summary aggregations match individual token sums

## Performance Testing

Test endpoint response times with larger datasets:

```bash
# Time the metrics endpoint
time curl -X GET "http://localhost:5000/api/analytics/metrics" \
  -H "Authorization: Bearer YOUR_TOKEN"

# Acceptable response time: < 2 seconds for datasets with 50+ tokens
```

## Integration Testing

### Test with External Dashboards:
1. Export metrics to Dune Analytics (if configured)
2. Verify data appears in Dune tables
3. Test webhook sync endpoint: `POST /api/analytics/sync`

### Test Edge Cases:
1. **No tokens:** Verify endpoints return empty arrays with zero totals
2. **No transfers:** Verify endpoints handle tokens with no transfer events
3. **Invalid days parameter:** Test with days=0, days=366, days=-1 (should be constrained to 1-365)
4. **Authentication:** Test without JWT token (should return 401)

## Troubleshooting

### Empty results
- Verify MongoDB has sample SorobanEvent records
- Check that contractIds in events match Token contractIds
- Ensure eventType contains "transfer" keyword

### Performance issues
- Add database indexes: `db.sorobanevents.createIndex({ contractId: 1, eventType: 1 })`
- Consider pagination for large datasets in future versions

### Authorization errors
- Verify JWT token is valid and not expired
- Check authentication middleware configuration

## Success Criteria

Your implementation is complete when:
1. ✅ All 5 endpoints respond with data in expected format
2. ✅ No authorization errors occur
3. ✅ Data aggregations are mathematically correct
4. ✅ Response times are acceptable (< 2s)
5. ✅ All edge cases handled gracefully
6. ✅ Linting and code validation passes
