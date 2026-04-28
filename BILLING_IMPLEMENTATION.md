# Stripe-Powered Tiered Usage Limits - Implementation Summary

## Feature Overview

This implementation adds a comprehensive three-tier billing system (Free, Pro, Enterprise) with Stripe integration and hard/soft deployment limits to SoroMint.

## Issue Reference
- **Issue #167**: Stripe-Powered Tiered Usage Limits
- **Complexity**: High
- **Area**: Backend

## What's Implemented

### 1. Database Models

#### AccountTier Model (`models/AccountTier.js`)
- Defines tier configurations (name, price, limits, features)
- Stores Stripe product and price IDs
- Includes feature flags for tier-specific capabilities

#### Billing Model (`models/Billing.js`)
- Tracks user billing information
- Stores Stripe customer and subscription IDs
- Records payment history and subscription status
- Manages billing address and payment methods

#### DeploymentUsage Model (`models/DeploymentUsage.js`)
- Tracks monthly deployment usage per user
- Records soft limit warnings
- Tracks billing period dates
- Manages hard limit exceeded status

#### User Model (Enhanced)
- Added `accountTierId` field to track current tier
- Added `tierChangedAt` timestamp
- Added `totalDeployments` counter
- Added `hasReceivedTrial` flag

### 2. Core Service: BillingService (`services/billing-service.js`)

**Key Methods:**

- `initializeAccountTiers()` - Initializes default tiers in database
- `createStripeCustomer()` - Creates Stripe customer for user
- `createSubscription()` - Creates Stripe subscription with price
- `upgradeTier()` / `downgradeTier()` - Manages tier changes
- `incrementDeploymentCount()` - Tracks usage, enforces hard limits
- `getDeploymentUsage()` - Returns current usage stats
- `cancelSubscription()` - Cancels Stripe subscription
- `handleStripeWebhook()` - Processes Stripe webhook events
- `handleSubscriptionUpdated()` - Updates subscription status
- `handleSubscriptionDeleted()` - Reverts to free tier
- `handlePaymentSucceeded()` / `handlePaymentFailed()` - Records payment status

**Features:**
- Stripe API integration
- Automatic hard limit enforcement
- Soft limit warning tracking
- Webhook event handling
- Subscription lifecycle management

### 3. API Routes (`routes/billing-routes.js`)

**Public Endpoints:**
- `GET /billing/tiers` - List all active tiers
- `GET /billing/tiers/:id` - Get specific tier details

**Private Endpoints:**
- `GET /billing/info` - Get user's billing information
- `GET /billing/usage` - Get current deployment usage
- `GET /billing/deployment-limit-status` - Get deployment limit status
- `POST /billing/create-customer` - Create Stripe customer
- `POST /billing/subscribe` - Subscribe to a tier
- `POST /billing/upgrade` - Upgrade to higher tier
- `POST /billing/downgrade` - Downgrade to lower tier
- `POST /billing/cancel-subscription` - Cancel subscription

**Webhook Endpoint:**
- `POST /billing/webhook/stripe` - Stripe webhook receiver (signature verified)

### 4. Middleware (`middleware/deployment-limit-middleware.js`)

**Three Middleware Functions:**

1. **checkDeploymentLimit**
   - Enforces hard limits
   - Prevents deployment if limit reached
   - Sets warning headers near soft limit
   - Returns 403 if limit exceeded

2. **trackDeployment**
   - Automatically increments usage counter
   - Called after successful deployment
   - Non-blocking async operation

3. **checkFeatureAccess**
   - Verifies tier has feature access
   - Prevents access to tier-specific features
   - Returns 403 if feature not available

### 5. Configuration & Documentation

#### .env.example (Updated)
- Added all Stripe configuration keys
- Documented billing period configuration
- Includes default tier settings

#### Documentation Files

**1. `docs/billing-system.md`**
- Comprehensive system overview
- Tier definitions and pricing
- Hard/soft limit explanation
- Complete API reference
- Database model documentation
- Setup instructions
- Testing guide
- Error handling examples
- Future enhancements

**2. `docs/billing-integration-guide.md`**
- Step-by-step integration instructions
- Frontend code examples
- Token deployment route integration
- Billing UI components
- Testing procedures
- Webhook configuration
- Debugging tips
- Performance considerations
- Security best practices

## Tier Configuration

### Free Tier
- **Price**: $0/month
- **Deployments**: 10/month (Hard limit)
- **Features**: API access
- **Support**: Community

### Pro Tier
- **Price**: $29.99/month
- **Deployments**: 100/month (Hard limit)
- **Features**: Advanced analytics, multi-sig, custom networks, webhooks
- **Support**: Priority email

### Enterprise Tier
- **Price**: $99.99/month
- **Deployments**: Unlimited
- **Features**: All Pro features + custom SLA
- **Support**: Dedicated

## Limit Enforcement

### Hard Limits
- Strictly enforced before deployment
- Returns HTTP 403 if exceeded
- Can't be bypassed by any user
- Resets monthly (1st of month)

### Soft Limits
- Default: 80% of hard limit
- Warning notifications sent
- Included in response headers
- Can be sent multiple times per period

## Stripe Integration Points

### Subscription Management
- Create subscriptions with Stripe priceId
- Update subscription on tier change
- Automatic proration handling
- Cancel at period end option

### Payment Tracking
- Records successful payments
- Tracks failed payments
- Retries failed charges
- Maintains payment history

### Webhook Events
- `customer.subscription.updated` - Updates status
- `customer.subscription.deleted` - Reverts to free
- `invoice.payment_succeeded` - Records success
- `invoice.payment_failed` - Tracks failures

## File Structure

```
server/
├── models/
│   ├── AccountTier.js (NEW)
│   ├── Billing.js (NEW)
│   ├── DeploymentUsage.js (NEW)
│   └── User.js (UPDATED)
├── services/
│   └── billing-service.js (NEW)
├── routes/
│   └── billing-routes.js (NEW)
├── middleware/
│   └── deployment-limit-middleware.js (NEW)
├── migrations/
│   └── initialize-billing-system.js (NEW)
├── docs/
│   ├── billing-system.md (NEW)
│   └── billing-integration-guide.md (NEW)
├── .env.example (UPDATED)
└── index.js (UPDATED)
```

## Changes Made

### Dependencies
- Added `stripe@^14.0.0` to package.json

### Main Application File (index.js)
- Imported BillingService
- Added billing routes to app
- Added billing system initialization on startup
- Graceful handling if initialization fails

### User Model
- Added tier tracking fields
- Added deployment counter
- Added trial eligibility

## Setup Instructions

### 1. Install Dependencies
```bash
cd server
npm install --legacy-peer-deps
```

### 2. Configure Environment
```bash
# Copy and edit .env
cp .env.example .env

# Add Stripe keys from https://dashboard.stripe.com/apikeys
STRIPE_SECRET_KEY=sk_test_...
STRIPE_PUBLIC_KEY=pk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
```

### 3. Initialize Billing System
```bash
# Creates default account tiers
node migrations/initialize-billing-system.js
```

### 4. Start Server
```bash
npm run dev
```

### 5. Configure Stripe Webhook
1. Go to https://dashboard.stripe.com/webhooks
2. Create endpoint: `https://yourdomain.com/api/billing/webhook/stripe`
3. Select events: subscription.updated, subscription.deleted, invoice.payment_succeeded, invoice.payment_failed
4. Copy signing secret to `STRIPE_WEBHOOK_SECRET`

## Testing

### Test Hard Limit
```bash
# Create test user with free tier (10 deployments/month)
curl -X GET http://localhost:3000/api/billing/deployment-limit-status \
  -H "Authorization: Bearer YOUR_TOKEN"

# Deploy 11 tokens - 11th should return 403
```

### Test Soft Limit Warning
```bash
# Deploy until usage reaches 80%
# Response headers should include:
# X-Deployment-Warning: true
# X-Deployments-Remaining: 2
```

### Test Stripe Integration
```bash
# Using Stripe CLI
stripe listen --forward-to localhost:3000/api/billing/webhook/stripe

# In another terminal
stripe trigger customer.subscription.updated
stripe trigger invoice.payment_succeeded
```

## API Usage Examples

### Get Available Tiers
```bash
curl http://localhost:3000/api/billing/tiers
```

### Check Usage
```bash
curl -H "Authorization: Bearer TOKEN" \
  http://localhost:3000/api/billing/usage
```

### Upgrade to Pro
```bash
curl -X POST http://localhost:3000/api/billing/upgrade \
  -H "Authorization: Bearer TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"tierName":"pro"}'
```

## Key Features

✅ Three-tier system (Free, Pro, Enterprise)
✅ Stripe billing integration
✅ Hard deployment limits
✅ Soft limit warnings
✅ Webhook event handling
✅ Subscription lifecycle
✅ Feature access control
✅ Monthly usage tracking
✅ Payment history
✅ Automatic tier management

## Security Features

✅ Stripe webhook signature verification
✅ JWT authentication for protected routes
✅ Feature access control by tier
✅ Hard limit enforcement (can't bypass)
✅ No PII in logs
✅ Secure payment handling

## Performance Optimizations

✅ Indexed MongoDB queries (userId, year, month)
✅ Efficient usage tracking
✅ Webhook processing without blocking
✅ Caching considerations documented

## Future Enhancements

- [ ] Email notifications for soft limits
- [ ] Usage analytics dashboard
- [ ] Automatic tier downgrade on failed payments
- [ ] Annual billing with discounts
- [ ] Usage-based billing option
- [ ] Multi-user team tiers
- [ ] Custom limits for enterprises
- [ ] Referral discount integration

## Testing Checklist

- [ ] Stripe keys configured
- [ ] Billing system initialized
- [ ] Account tiers created in database
- [ ] Stripe customer creation works
- [ ] Subscription creation works
- [ ] Hard limit enforcement works
- [ ] Soft limit warnings work
- [ ] Tier upgrade works
- [ ] Tier downgrade works
- [ ] Webhook events processed correctly
- [ ] Payment tracking works
- [ ] Subscription cancellation works
- [ ] Feature access control works

## Deployment Notes

1. **Database**: Requires MongoDB with indexes on deploymentusages collection
2. **Stripe**: Use test keys for staging, production keys for live
3. **Webhooks**: Configure IP whitelist for Stripe IP addresses
4. **Monitoring**: Monitor failed payments and subscription issues
5. **Backups**: Ensure billing data is backed up regularly

## Support & Documentation

- Comprehensive system documentation: `docs/billing-system.md`
- Integration guide: `docs/billing-integration-guide.md`
- Stripe API docs: https://stripe.com/docs/api
- Code is well-commented for maintenance

## Credits

Implemented as resolution for Issue #167: Stripe-Powered Tiered Usage Limits
Feature branch: `feature/stripe-tiered-usage-limits`
