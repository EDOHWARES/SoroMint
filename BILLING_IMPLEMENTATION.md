# Billing System - What Was Added

Stripe integration with three tiers, deployment limits, and subscription management.

## New Models

- **AccountTier** - Tier config (name, price, deployment limit, features)
- **Billing** - Subscription info, payment history, Stripe customer ID
- **DeploymentUsage** - Monthly deployment count per user

## New Service

**BillingService** (`services/billing-service.js`)
- Initialize tiers
- Create Stripe customers and subscriptions
- Upgrade/downgrade tiers
- Track deployment usage
- Handle Stripe webhooks (subscription updates, payments)

## Routes

**Public:**
- `GET /billing/tiers` - List tiers
- `GET /billing/tiers/:id` - Get tier details

**Private (requires auth):**
- `GET /billing/info` - User billing info
- `GET /billing/usage` - Current deployment usage
- `POST /billing/subscribe` - Subscribe to tier
- `POST /billing/upgrade` - Upgrade tier
- `POST /billing/downgrade` - Downgrade tier
- `POST /billing/cancel-subscription` - Cancel subscription

**Webhook:**
- `POST /billing/webhook/stripe` - Stripe webhook (signature verified)

## Middleware

- `checkDeploymentLimit` - Blocks deployment if limit reached
- `trackDeployment` - Counts deployments on success
- `checkFeatureAccess` - Blocks features not in tier

## Files Added/Changed

New files:
- `models/AccountTier.js`, `Billing.js`, `DeploymentUsage.js`
- `services/billing-service.js`
- `routes/billing-routes.js`
- `middleware/deployment-limit-middleware.js`
- `migrations/initialize-billing-system.js`
- `docs/billing-system.md`, `billing-integration-guide.md`

Updated:
- `models/User.js` - Added tier tracking
- `package.json` - Added stripe dependency
- `index.js` - Added billing routes and initialization
- `.env.example` - Added Stripe config

## Setup

1. Install: `npm install --legacy-peer-deps`
2. Configure `.env` with Stripe keys
3. Run: `node migrations/initialize-billing-system.js`
4. Start: `npm run dev`
5. Add webhook in Stripe dashboard

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
