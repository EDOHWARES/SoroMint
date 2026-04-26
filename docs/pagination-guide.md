# Pagination Guide

This document explains how to use pagination with the SoroMint API.

## Endpoints Supported

- `GET /api/tokens/:owner`

## Query Parameters

| Parameter | Type     | Default | Description                                |
| :-------- | :------- | :------ | :----------------------------------------- |
| `page`    | `number` | `1`     | The page number to retrieve (starts at 1). |
| `limit`   | `number` | `20`    | The number of items per page (max: 100).   |

## Response Format

The paginated endpoints return a wrapped object containing the `data` array and a `metadata` object.

### Example Request

`GET /api/tokens/GDZY...VOVP?page=1&limit=5`

### Example Response

```json
{
  "success": true,
  "data": [
    {
      "id": "60d5f9b4f1b2c8001f8e4e1a",
      "name": "My Token",
      "symbol": "MTK",
      "decimals": 7,
      "contractId": "CA76...XYZ",
      "ownerPublicKey": "GDZY...VVP",
      "createdAt": "2024-03-24T12:00:00Z"
    }
  ],
  "metadata": {
    "totalCount": 45,
    "page": 1,
    "totalPages": 9,
    "limit": 5
  }
}
```

## Error Handling

If invalid pagination parameters are provided (e.g., `page=0` or `limit=101`), the API will return a `400 Bad Request` with a validation error message.
