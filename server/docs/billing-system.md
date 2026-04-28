# Stripe-Powered Tiered Usage Limits

## Overview

This feature implements a three-tier account system (Free, Pro, Enterprise) with Stripe billing integration and hard/soft deployment limits.

## Account Tiers

### Free Tier
- **Price**: $0/month
- **Max Deployments**: 10 per month
- **Features**:
  - Basic API access
  - Community support

### Pro Tier
- **Price**: $29.99/month
- **Max Deployments**: 100 per month
- **Features**:
  - Advanced analytics
  - Multi-sig deployment support
  - Custom network deployment
  - Priority email support
  - Webhook integration
  - Full API access

### Enterprise Tier
- **Price**: $99.99/month
- **Max Deployments**: Unlimited
- **Features**:
  - All Pro features
  - Dedicated support
  - Custom SLA
  - Advanced security features

## Deployment Limits

### Hard Limits
- Users cannot exceed their tier's monthly deployment limit
- Attempting to deploy when at limit returns HTTP 403 error
- Limit resets on the first day of each calendar month

### Soft Limits
- Default threshold: 80% of monthly limit
- Warning notifications sent when approaching limit
- Header `X-Deployment-Warning: true` included in responses when near limit

## Environment Variables

Add these to your `.env` file:

```bash
# Stripe Keys
STRIPE_SECRET_KEY=sk_live_xxxxxxxxxxxxx
STRIPE_PUBLIC_KEY=pk_live_xxxxxxxxxxxxx
STRIPE_WEBHOOK_SECRET=whsec_xxxxxxxxxxxxx

# Optional: Stripe signing secret for webhook verification
STRIPE_SIGNING_SECRET=sk_live_xxxxxxxxxxxxx
```

## API Endpoints

### Public Endpoints

#### Get All Available Tiers
```
GET /billing/tiers
```

Response:
```json
[
  {
    "_id": "...",
    "name": "free",
    "displayName": "Free",
    "monthlyPriceCents": 0,
    "maxDeploymentsPerMonth": 10,
    "features": {...},
    "description": "Get started with SoroMint"
  },
  ...
]
```

#### Get Specific Tier
```
GET /billing/tiers/:id
```

### Private Endpoints (Authentication Required)

#### Get Current User's Billing Info
```
GET /billing/info
```

Response:
```json
{
  "userId": "...",
  "accountTierId": "...",
  "stripeCustomerId": "cus_xxxxx",
  "stripeSubscriptionId": "sub_xxxxx",
  "subscriptionStatus": "active",
  "currentPeriodStart": "2026-04-01T00:00:00.000Z",
  "currentPeriodEnd": "2026-05-01T00:00:00.000Z",
  "lastPaymentAt": "2026-04-01T00:00:00.000Z",
  "lastPaymentStatus": "succeeded"
}
```

#### Get Current Deployment Usage
```
GET /billing/usage
```

Response:
```json
{
  "deploymentsCount": 8,
  "maxDeployments": 10,
  "percentageUsed": 80,
  "isLimitExceeded": false,
  "periodStart": "2026-04-01T00:00:00.000Z",
  "periodEnd": "2026-05-01T00:00:00.000Z"
}
```

#### Get Deployment Limit Status
```
GET /billing/deployment-limit-status
```

Response:
```json
{
  "canDeploy": true,
  "used": 8,
  "limit": 10,
  "remaining": 2,
  "percentageUsed": 80,
  "periodStart": "2026-04-01T00:00:00.000Z",
  "periodEnd": "2026-05-01T00:00:00.000Z"
}
```

#### Create Stripe Customer
```
POST /billing/create-customer
```

Response:
```json
{
  "userId": "...",
  "stripeCustomerId": "cus_xxxxx",
  "subscriptionStatus": "active"
}
```

#### Subscribe to Tier
```
POST /billing/subscribe
Content-Type: application/json

{
  "tierName": "pro"
}
```

#### Upgrade Tier
```
POST /billing/upgrade
Content-Type: application/json

{
  "tierName": "enterprise"
}
```

#### Downgrade Tier
```
POST /billing/downgrade
Content-Type: application/json

{
  "tierName": "free"
}
```

#### Cancel Subscription
```
POST /billing/cancel-subscription
Content-Type: application/json

{
  "cancelAtPeriodEnd": true
}
```

### Webhook Endpoint

#### Stripe Webhook
```
POST /billing/webhook/stripe
```

The webhook endpoint handles:
- `customer.subscription.updated`: Updates subscription status
- `customer.subscription.deleted`: Reverts user to free tier
- `invoice.payment_succeeded`: Records successful payment
- `invoice.payment_failed`: Records failed payment

## Middleware

### Check Deployment Limit
```javascript
const { checkDeploymentLimit } = require('../middleware/deployment-limit-middleware');

router.post('/deploy', checkDeploymentLimit, deploymentHandler);
```

This middleware:
- Checks if user has reached hard limit
- Returns 403 if limit exceeded
- Adds warning headers if near soft limit

### Track Deployment
```javascript
const { trackDeployment } = require('../middleware/deployment-limit-middleware');

router.post('/deploy', trackDeployment, deploymentHandler);
```

This middleware automatically increments the deployment counter on successful deployment.

### Check Feature Access
```javascript
const { checkFeatureAccess } = require('../middleware/deployment-limit-middleware');

router.post('/webhooks', checkFeatureAccess('webhooks'), webhookHandler);
```

This middleware verifies that the user's tier has access to the required feature.

## Database Models

### AccountTier
Defines tier configuration:
- `name`: Unique tier identifier (free, pro, enterprise)
- `displayName`: Human-readable name
- `monthlyPriceCents`: Price in cents
- `maxDeploymentsPerMonth`: Hard limit (null = unlimited)
- `softLimitPercentage`: Warning threshold percentage
- `features`: Feature flags for the tier
- `stripeProductId`: Stripe product ID
- `stripePriceId`: Stripe price ID

### Billing
Tracks user billing information:
- `userId`: Reference to User
- `stripeCustomerId`: Stripe customer ID
- `stripeSubscriptionId`: Stripe subscription ID
- `subscriptionStatus`: Current subscription status
- `currentPeriodStart/End`: Billing period dates
- `paymentMethodId`: Stripe payment method
- `lastPaymentStatus`: Status of last payment

### DeploymentUsage
Tracks monthly deployment usage:
- `userId`: Reference to User
- `year`, `month`: Billing period
- `deploymentsCount`: Current deployment count
- `maxDeployments`: Limit for this period
- `isLimitExceeded`: Hard limit exceeded flag

### User (Extended)
Added fields to User model:
- `accountTierId`: Reference to current tier
- `tierChangedAt`: Timestamp of last tier change
- `totalDeployments`: All-time deployment count
- `hasReceivedTrial`: Trial eligibility flag

## Setup Instructions

### 1. Install Dependencies
```bash
cd server
npm install --legacy-peer-deps
```

### 2. Configure Environment Variables
```bash
cp .env.example .env
# Edit .env and add Stripe keys
```

### 3. Initialize Billing System
```bash
node migrations/initialize-billing-system.js
```

This creates the default account tiers in the database.

### 4. Update Main Server File
Add to your main `index.js`:

```javascript
const billingRoutes = require('./routes/billing-routes');
const { checkDeploymentLimit } = require('./middleware/deployment-limit-middleware');

// Initialize billing system on startup
const BillingService = require('./services/billing-service');
BillingService.initializeAccountTiers().catch(err => {
  logger.error('Failed to initialize billing system:', err);
});

// Mount billing routes
app.use('/api/billing', billingRoutes);

// Add deployment limit check to token deployment routes
app.post('/api/tokens/deploy', checkDeploymentLimit, tokenDeploymentHandler);
```

### 5. Configure Stripe Webhook
1. Go to [Stripe Dashboard](https://dashboard.stripe.com)
2. Navigate to Webhooks
3. Create new endpoint: `https://yourdomain.com/api/billing/webhook/stripe`
4. Select events:
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
   - `invoice.payment_succeeded`
   - `invoice.payment_failed`
5. Copy webhook signing secret to `STRIPE_WEBHOOK_SECRET` in `.env`

## Testing

### Using Stripe Test Keys
```bash
STRIPE_SECRET_KEY=sk_test_xxxxxxxxxxxxx
STRIPE_PUBLIC_KEY=pk_test_xxxxxxxxxxxxx
```

### Test Card Numbers
- Success: `4242 4242 4242 4242`
- Decline: `4000 0000 0000 0002`
- Expired: `4000 0000 0000 0069`

### Webhook Testing with Stripe CLI
```bash
stripe listen --forward-to localhost:3000/api/billing/webhook/stripe

# In another terminal
stripe trigger payment_intent.succeeded
```

## Error Handling

### Deployment Limit Exceeded
```json
{
  "error": "Deployment limit reached",
  "message": "You have reached your monthly deployment limit of 10",
  "remaining": 0,
  "used": 10,
  "limit": 10
}
```

### Feature Not Available
```json
{
  "error": "Feature not available for your tier",
  "message": "The webhooks feature is not available in your current plan. Please upgrade to access this feature.",
  "currentTier": "free"
}
```

## Monitoring and Alerts

Monitor these metrics:
1. **Failed Payments**: Track users with failed payments
2. **Approaching Limit**: Users at 80% of deployment limit
3. **Over Limit**: Users attempting deployment over limit
4. **Subscription Status**: Active/canceled/past_due subscriptions

## Future Enhancements

- [ ] Email notifications for soft/hard limits
- [ ] Automatic tier downgrade on failed payments
- [ ] Usage analytics and reports
- [ ] Custom billing periods
- [ ] Promotional/referral discounts
- [ ] Usage-based billing option
- [ ] Annual billing discount
- [ ] Multi-user team tiers

## Support

For Stripe integration issues, see:
- [Stripe API Documentation](https://stripe.com/docs/api)
- [Stripe Webhooks](https://stripe.com/docs/webhooks)
- [Stripe Node.js Library](https://github.com/stripe/stripe-node)
