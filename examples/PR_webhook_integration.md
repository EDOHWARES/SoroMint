# Feat: Customizable Webhook Integration for External Apps

## Description

This PR implements the **Customizable Webhook Integration**, allowing users to register callback URLs and receive HTTP POST notifications triggered in real-time by their token's on-chain transfer and burn events.

### Key Features & Changes

*   **Expanded Event Types**:
    *   Updated the `Webhook` Mongoose model to support `token.transferred` and `token.burned` in the `events` array.
    *   Updated the `webhookSchema` (Zod validation) in `webhook-routes.js` to securely validate and accept these new event subscriptions from users.
*   **Event Dispatch Integration**:
    *   Updated `batch-routes.js` to automatically intercept successful `transfer` and `burn` operations processed through `submitBatchOperations`.
    *   For each successful operation, the backend invokes the `dispatch()` service, passing along comprehensive payload data including:
        *   `txHash`
        *   `contractId`
        *   `amount`
        *   `source` (and `destination` for transfers)

## Note on Architecture
Because the SoroMint backend currently operates without a background ledger indexer, this webhook integration is specifically wired into the `POST /api/tokens/batch` endpoint. It guarantees that any transfers or burns submitted and executed via the SoroMint API will successfully trigger external callbacks, fitting perfectly within current architectural constraints.

Closes #166
