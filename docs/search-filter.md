# Asset Search and Filter Service

## Overview

The Asset Search and Filter Service provides users with the ability to search and filter their deployed tokens through the API. This feature supports case-insensitive partial matching on token names and symbols, seamlessly integrating with the existing pagination system.

## Features

- **Case-insensitive search**: Search queries match regardless of case
- **Partial matching**: Find tokens with partial name or symbol matches
- **Multi-field search**: Searches across both `name` and `symbol` fields simultaneously
- **Pagination integration**: Works seamlessly with existing pagination parameters
- **Input validation**: Search queries are validated for length and format

## API Endpoint

### GET /api/tokens/:owner

Retrieves a paginated list of tokens for a specific owner, with optional search filtering.

#### Path Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `owner` | string | Owner's Stellar public key (G... format) |

#### Query Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `page` | number | 1 | Page number for pagination |
| `limit` | number | 20 | Number of items per page (max: 100) |
| `search` | string | - | Optional search query for token name or symbol |

#### Request Examples

**Without search:**
```bash
curl -X GET "https://api.soromint.com/api/tokens/GDZ...?page=1&limit=20" \
  -H "Authorization: Bearer <jwt-token>"
```

**With search:**
```bash
curl -X GET "https://api.soromint.com/api/tokens/GDZ...?page=1&limit=20&search=soro" \
  -H "Authorization: Bearer <jwt-token>"
```

#### Response Format

```json
{
  "success": true,
  "data": [
    {
      "_id": "...",
      "name": "SoroMint Token",
      "symbol": "SORO",
      "decimals": 7,
      "contractId": "CA3D5KRYM6CB7OWQ6TWYRR3Z4T7GNZLKERYNZGGA5SOAOPIFY6YQGAXE",
      "ownerPublicKey": "GDZ...",
      "createdAt": "2024-01-15T10:30:00.000Z"
    }
  ],
  "metadata": {
    "totalCount": 15,
    "page": 1,
    "totalPages": 1,
    "limit": 20,
    "search": "soro"
  }
}
```

## Search Behavior

### Case-Insensitive Matching

The search is case-insensitive, meaning the following queries will all match "SoroMint Token":
- `soro`
- `SORO`
- `Soro`
- `sORO`

### Partial Matching

The search supports partial matches:
- Query `sor` matches "SoroMint Token"
- Query `mint` matches "SoroMint Token"
- Query `SORO` matches token with symbol "SORO"

### Multi-Field Search

The search checks both `name` and `symbol` fields:
- A token with name "My Token" and symbol "MYT" will match:
  - Query `my` (matches name)
  - Query `token` (matches name)
  - Query `myt` (matches symbol)

## Validation Rules

The search query is validated according to the following rules:

| Rule | Constraint | Error Message |
|------|------------|---------------|
| Minimum length | 1 character | "Search query must be at least 1 character" |
| Maximum length | 50 characters | "Search query must not exceed 50 characters" |
| Type | string | "Expected string, received..." |

Empty search strings are treated as no search filter (returns all tokens).

## Implementation Details

### Database Query

The search uses MongoDB's `$regex` operator with the `i` flag for case-insensitive matching:

```javascript
const searchRegex = new RegExp(search, "i");
const queryFilter = {
  ownerPublicKey: owner,
  $or: [
    { name: { $regex: searchRegex } },
    { symbol: { $regex: searchRegex } },
  ],
};
```

### Performance Considerations

- **Regex Performance**: The search uses unanchored regex patterns which may impact performance with large datasets
- **Index Recommendations**: Consider adding text indexes for better performance:
  ```javascript
  TokenSchema.index({ name: 'text', symbol: 'text' });
  ```
- **Result Counting**: The total count reflects filtered results, not the total collection size

### Security Considerations

- **Regex Injection**: Input is validated and length-limited to prevent ReDoS attacks
- **Owner Isolation**: Search is always scoped to the authenticated owner's tokens
- **Authentication**: JWT authentication is required for all search requests

## Testing

### Example Test Cases

```javascript
// Test case-insensitive search
describe("Token Search", () => {
  it("should find tokens with case-insensitive name match", async () => {
    const response = await request(app)
      .get("/api/tokens/GDZ...?search=soro")
      .set("Authorization", `Bearer ${token}`);

    expect(response.body.data).toHaveLength(1);
    expect(response.body.data[0].name).toBe("SoroMint Token");
  });

  it("should find tokens with symbol match", async () => {
    const response = await request(app)
      .get("/api/tokens/GDZ...?search=SORO")
      .set("Authorization", `Bearer ${token}`);

    expect(response.body.data[0].symbol).toBe("SORO");
  });

  it("should return empty array for non-matching search", async () => {
    const response = await request(app)
      .get("/api/tokens/GDZ...?search=xyz123")
      .set("Authorization", `Bearer ${token}`);

    expect(response.body.data).toHaveLength(0);
    expect(response.body.metadata.totalCount).toBe(0);
  });
});
```

## Integration with Pagination

The search filter works seamlessly with pagination:

1. **Total Count**: Reflects the number of matching tokens, not total tokens
2. **Page Navigation**: `totalPages` is calculated based on filtered results
3. **Consistent Interface**: Response format remains the same with or without search

### Example Flow

1. User has 100 tokens
2. Search for "soro" returns 15 matches
3. With `limit=10`, `totalPages=2`
4. Requesting `page=2` returns tokens 11-15 of the matching results

## Error Handling

| Error | Status Code | Description |
|-------|-------------|-------------|
| Invalid search length | 400 | Search query too short or too long |
| Invalid pagination | 400 | Page or limit parameters invalid |
| Unauthorized | 401 | Missing or invalid JWT token |
| Not found | 404 | Owner not found (if applicable) |

## Future Enhancements

Potential improvements to the search functionality:

1. **Full-Text Search**: Implement MongoDB text indexes for better performance
2. **Advanced Filters**: Add date range, decimal places, or other field filters
3. **Sorting Options**: Allow sorting by name, symbol, or creation date
4. **Fuzzy Search**: Implement fuzzy matching for typo tolerance
5. **Search Suggestions**: Provide autocomplete/suggestions for search queries
