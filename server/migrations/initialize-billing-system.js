const mongoose = require('mongoose');
const BillingService = require('../services/billing-service');
const logger = require('winston');

/**
 * @title Initialize Billing System
 * @author SoroMint Team
 * @notice Initializes account tiers and billing collections
 * @dev Run this script once after deployment to set up the billing system
 */

async function initializeBillingSystem() {
  try {
    logger.info('Starting billing system initialization...');

    // Initialize account tiers
    await BillingService.initializeAccountTiers();

    logger.info('Billing system initialized successfully');
    process.exit(0);
  } catch (error) {
    logger.error('Error initializing billing system:', error);
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  initializeBillingSystem();
}

module.exports = initializeBillingSystem;
