# Billing System Integration Guide

## Overview

This guide explains how to integrate the new billing and tiered deployment limits system into existing routes.

## Step 1: Add Deployment Limit Middleware to Token Routes

Update your token deployment routes to include the deployment limit middleware:

```javascript
// routes/token-routes.js

const { 
  checkDeploymentLimit, 
  trackDeployment,
  checkFeatureAccess 
} = require('../middleware/deployment-limit-middleware');

/**
 * @route POST /api/tokens/deploy
 * @description Deploy a new token with deployment limit enforcement
 */
router.post(
  '/deploy',
  authenticate,
  checkDeploymentLimit,      // Check if user can deploy
  trackDeployment,           // Track usage on success
  async (req, res) => {
    // Your existing deployment logic here
    // ...
  }
);

/**
 * @route POST /api/tokens/deploy-with-multisig
 * @description Deploy with multi-sig (Pro tier feature)
 */
router.post(
  '/deploy-with-multisig',
  authenticate,
  checkDeploymentLimit,
  checkFeatureAccess('multiSigDeployment'),
  trackDeployment,
  async (req, res) => {
    // Your existing multi-sig deployment logic
    // ...
  }
);

/**
 * @route POST /api/webhooks/register
 * @description Register a webhook (Pro tier feature)
 */
router.post(
  '/webhooks/register',
  authenticate,
  checkFeatureAccess('webhooks'),
  async (req, res) => {
    // Your existing webhook logic
    // ...
  }
);
```

## Step 2: Handle Deployment Limit Errors in Frontend

Update your frontend to handle tier-related errors:

```javascript
// frontend/api/tokenService.js

async function deployToken(tokenConfig) {
  try {
    const response = await fetch('/api/tokens/deploy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(tokenConfig),
    });

    if (response.status === 403) {
      const error = await response.json();
      
      if (error.error === 'Deployment limit reached') {
        // Show upgrade modal
        showUpgradeModal({
          message: error.message,
          remaining: error.remaining,
          currentLimit: error.limit,
          suggestedTier: 'pro', // Auto-suggest Pro tier
        });
        return null;
      }
      
      if (error.error === 'Feature not available for your tier') {
        // Show feature upsell
        showFeatureUpsellModal({
          feature: error.message,
          currentTier: error.currentTier,
        });
        return null;
      }
    }

    if (!response.ok) {
      throw new Error(await response.text());
    }

    // Check for soft limit warning
    if (response.headers.get('X-Deployment-Warning') === 'true') {
      const remaining = response.headers.get('X-Deployments-Remaining');
      showWarningNotification(`Only ${remaining} deployments remaining this month`);
    }

    return await response.json();
  } catch (error) {
    console.error('Deployment failed:', error);
    throw error;
  }
}
```

## Step 3: Display Billing Info in User Dashboard

Add billing information to user profiles:

```javascript
// frontend/components/UserProfile.jsx

import { useEffect, useState } from 'react';

export function UserProfile() {
  const [billing, setBilling] = useState(null);
  const [usage, setUsage] = useState(null);

  useEffect(() => {
    async function fetchBillingInfo() {
      try {
        const [billingRes, usageRes] = await Promise.all([
          fetch('/api/billing/info'),
          fetch('/api/billing/usage'),
        ]);

        setBilling(await billingRes.json());
        setUsage(await usageRes.json());
      } catch (error) {
        console.error('Failed to fetch billing info:', error);
      }
    }

    fetchBillingInfo();
  }, []);

  if (!billing || !usage) return <div>Loading...</div>;

  return (
    <div className="user-profile">
      <h2>Account Tier: {billing.accountTierId.displayName}</h2>
      
      {usage.maxDeployments && (
        <div className="usage-bar">
          <div className="label">
            Deployments: {usage.deploymentsCount} / {usage.maxDeployments}
          </div>
          <div className="progress-bar">
            <div 
              className="progress" 
              style={{ width: `${usage.percentageUsed}%` }}
            />
          </div>
          <div className="info">
            Period: {new Date(usage.periodStart).toLocaleDateString()} - {' '}
            {new Date(usage.periodEnd).toLocaleDateString()}
          </div>
        </div>
      )}

      {billing.subscriptionStatus === 'active' && (
        <p>Next billing date: {new Date(billing.currentPeriodEnd).toLocaleDateString()}</p>
      )}

      <div className="actions">
        {billing.accountTierId.name !== 'enterprise' && (
          <button onClick={() => showUpgradePage()}>Upgrade Tier</button>
        )}
        {billing.subscriptionStatus === 'active' && (
          <button onClick={() => showCancelModal()}>Cancel Subscription</button>
        )}
      </div>
    </div>
  );
}
```

## Step 4: Create Billing Management Page

Create a comprehensive billing management page:

```javascript
// frontend/pages/BillingPage.jsx

import { useEffect, useState } from 'react';

export function BillingPage() {
  const [tiers, setTiers] = useState([]);
  const [currentBilling, setCurrentBilling] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchData() {
      try {
        const [tiersRes, billingRes] = await Promise.all([
          fetch('/api/billing/tiers'),
          fetch('/api/billing/info'),
        ]);

        setTiers(await tiersRes.json());
        setCurrentBilling(await billingRes.json());
      } catch (error) {
        console.error('Failed to fetch billing data:', error);
      } finally {
        setLoading(false);
      }
    }

    fetchData();
  }, []);

  async function handleTierChange(tierName) {
    try {
      const endpoint = tierName === 'free' ? 'downgrade' : 'upgrade';
      const response = await fetch(`/api/billing/${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tierName }),
      });

      if (response.ok) {
        alert('Tier changed successfully');
        // Refresh billing info
        const billingRes = await fetch('/api/billing/info');
        setCurrentBilling(await billingRes.json());
      } else {
        alert('Failed to change tier');
      }
    } catch (error) {
      console.error('Error changing tier:', error);
    }
  }

  if (loading) return <div>Loading...</div>;

  return (
    <div className="billing-page">
      <h1>Billing & Plans</h1>

      {/* Tier Selection */}
      <div className="tier-selection">
        {tiers.map(tier => (
          <div key={tier._id} className={`tier-card ${tier.name === currentBilling?.accountTierId.name ? 'active' : ''}`}>
            <h3>{tier.displayName}</h3>
            <div className="price">
              ${tier.monthlyPriceCents / 100}/month
            </div>
            <div className="deployments">
              {tier.maxDeploymentsPerMonth ? 
                `${tier.maxDeploymentsPerMonth} deployments/month` :
                'Unlimited deployments'
              }
            </div>
            
            <ul className="features">
              {Object.entries(tier.features).map(([feature, enabled]) =>
                enabled && (
                  <li key={feature}>✓ {feature.replace(/([A-Z])/g, ' $1')}</li>
                )
              )}
            </ul>

            <button 
              onClick={() => handleTierChange(tier.name)}
              disabled={tier.name === currentBilling?.accountTierId.name}
            >
              {tier.name === currentBilling?.accountTierId.name ? 'Current Plan' : 'Select Plan'}
            </button>
          </div>
        ))}
      </div>

      {/* Subscription Info */}
      {currentBilling && (
        <div className="subscription-info">
          <h3>Subscription Details</h3>
          <p>Status: {currentBilling.subscriptionStatus}</p>
          <p>Period: {new Date(currentBilling.currentPeriodStart).toLocaleDateString()} - {new Date(currentBilling.currentPeriodEnd).toLocaleDateString()}</p>
          {currentBilling.lastPaymentAt && (
            <p>Last Payment: {new Date(currentBilling.lastPaymentAt).toLocaleDateString()}</p>
          )}
        </div>
      )}
    </div>
  );
}
```

## Step 5: Set Up Webhook Listener for Stripe Events

Configure Stripe CLI for local testing:

```bash
# Install Stripe CLI
brew install stripe/stripe-cli/stripe

# Authenticate
stripe login

# Listen for events
stripe listen --forward-to localhost:3000/api/billing/webhook/stripe

# In another terminal, trigger test events
stripe trigger customer.subscription.updated
stripe trigger invoice.payment_succeeded
```

## Step 6: Testing the Integration

### Test Hard Limit
```bash
# Create test user with free tier (10 deployments/month)
# Try deploying 11 tokens - 11th should fail with 403
```

### Test Soft Limit Warning
```bash
# Deploy 8 tokens (80% of free tier limit)
# Check response headers for X-Deployment-Warning: true
```

### Test Tier Upgrade
```bash
# Upgrade free tier user to pro
# Limit should increase from 10 to 100

POST /api/billing/upgrade
Content-Type: application/json

{ "tierName": "pro" }
```

### Test Subscription Webhook
```bash
# Stripe CLI will forward webhook events
# Verify billing status updates in database
```

## Monitoring and Debugging

### Check User Tier and Limits
```javascript
// Debug endpoint (add to auth-routes or admin routes)
app.get('/api/debug/user-tier/:userId', async (req, res) => {
  const user = await User.findById(req.params.userId)
    .populate('accountTierId');
  const usage = await DeploymentUsage.findOne({
    userId: req.params.userId,
    year: new Date().getFullYear(),
    month: new Date().getMonth() + 1,
  });
  
  res.json({ user, usage });
});
```

### View Billing Records
```bash
# In MongoDB shell
db.billings.find({ userId: ObjectId("...") })
db.deploymentusages.find({ userId: ObjectId("...") })
db.accounttiers.find()
```

## Common Issues

### Issue: "Stripe key not found"
- Solution: Ensure `STRIPE_SECRET_KEY` is set in `.env`

### Issue: "Billing record not found"
- Solution: Run `/api/billing/create-customer` or `node migrations/initialize-billing-system.js`

### Issue: Webhook events not received
- Solution: Verify `STRIPE_WEBHOOK_SECRET` and webhook endpoint URL in Stripe dashboard

### Issue: Soft limit warnings not sent
- TODO: Implement email notifications via SendGrid

## Performance Considerations

1. **Cache usage data**: Consider caching monthly usage with TTL
2. **Batch webhook processing**: Use job queues for high-volume webhooks
3. **Index optimization**: Ensure indexes on `userId`, `year`, `month`
4. **Stripe API rate limits**: Monitor API call counts

## Security Considerations

1. **Webhook verification**: Always verify Stripe signature
2. **PII in logs**: Don't log sensitive billing data
3. **Payment data**: Never store full credit card numbers
4. **API key rotation**: Rotate Stripe keys regularly
5. **Feature flags**: Use feature flags to control tier upgrades

## Next Steps

1. **Email Notifications**: Implement SendGrid integration for limit warnings
2. **Usage Analytics**: Add dashboard for billing analytics
3. **Custom Limits**: Allow admins to set custom limits per user
4. **Refunds**: Implement refund handling for failed payments
5. **Multiple Plans**: Support annual billing with discounts
