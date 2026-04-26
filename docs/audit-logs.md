# Token Deployment Audit Logs

The SoroMint platform provides a comprehensive auditing system for tracking token deployment actions. This allows administrators to monitor platform usage and users to troubleshoot failed deployments.

## Data Model (DeploymentAudit)

The `DeploymentAudit` model captures the following fields:

| Field | Type | Description |
|-------|------|-------------|
| `userId` | ObjectId | Reference to the `User` who initiated the action. |
| `tokenName` | String | The name of the token being deployed. |
| `contractId` | String | The resulting Stellar contract address (only on success). |
| `status` | String | Either `SUCCESS` or `FAIL`. |
| `errorMessage` | String | Detailed error message if the deployment failed. |
| `createdAt` | Date | Timestamp of the deployment attempt. |

## API Endpoints

### Get User Logs
`GET /api/deployments/logs`

Returns the last 50 deployment attempts for the authenticated user.

**Success Response:** `200 OK`
```json
[
  {
    "_id": "65f1a...",
    "tokenName": "My Token",
    "contractId": "CA...",
    "status": "SUCCESS",
    "createdAt": "2024-03-24T15:30:00Z"
  }
]
```

### Get Admin Logs (Internal)
`GET /api/admin/logs`

Returns deployment logs for all users. Supports filtering by status and user.

**Authentication:** Requires a JWT with `admin` role.

**Query Parameters:**
- `status`: Filter by `SUCCESS` or `FAIL`.
- `userId`: Filter by a specific user's ID.
- `tokenName`: Partial match search for token names.

**Success Response:** `200 OK`

## Implementation Details

The auditing logic is integrated into the `POST /api/tokens` endpoint. 

- **Validation Failures**: Logged with status `FAIL` and a description of missing fields.
- **Runtime Errors**: Logged with status `FAIL` and the error message from the exception.
- **Success**: Logged with status `SUCCESS` and the generated `contractId`.

NatSpec-style documentation is included in the source code for the `DeploymentAudit` model and the audit routes.
