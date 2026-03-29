const sgMail = require('@sendgrid/mail');
const webPush = require('web-push');
const { getEnv } = require('../config/env-config');
const { logger } = require('../utils/logger');
const NotificationPreferences = require('../models/NotificationPreferences');

let initialized = false;

const initNotificationService = () => {
  if (initialized) return;
  const env = getEnv();

  if (env.SENDGRID_API_KEY) {
    sgMail.setApiKey(env.SENDGRID_API_KEY);
    logger.info('SendGrid initialized for email notifications');
  } else {
    logger.warn('SENDGRID_API_KEY not set — email notifications disabled');
  }

  if (env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY) {
    webPush.setVapidDetails(
      env.VAPID_SUBJECT || 'mailto:admin@soromint.io',
      env.VAPID_PUBLIC_KEY,
      env.VAPID_PRIVATE_KEY,
    );
    logger.info('Web Push VAPID keys configured');
  } else {
    logger.warn('VAPID keys not set — web push notifications disabled');
  }

  initialized = true;
};

const sendEmail = async (to, subject, text, html) => {
  const env = getEnv();
  if (!env.SENDGRID_API_KEY) {
    logger.warn('SendGrid not configured, skipping email', { to, subject });
    return { sent: false, reason: 'SendGrid not configured' };
  }

  try {
    await sgMail.send({
      to,
      from: env.NOTIFICATION_FROM_EMAIL || 'noreply@soromint.io',
      subject,
      text,
      html: html || text,
    });
    logger.info('Email notification sent', { to, subject });
    return { sent: true };
  } catch (error) {
    logger.error('Failed to send email notification', { to, subject, error: error.message });
    return { sent: false, reason: error.message };
  }
};

const sendPushNotification = async (subscription, payload) => {
  const env = getEnv();
  if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY) {
    logger.warn('VAPID keys not configured, skipping push notification');
    return { sent: false, reason: 'VAPID not configured' };
  }

  if (!subscription || !subscription.endpoint) {
    return { sent: false, reason: 'Invalid subscription' };
  }

  try {
    await webPush.sendNotification(subscription, JSON.stringify(payload));
    logger.info('Push notification sent', { endpoint: subscription.endpoint });
    return { sent: true };
  } catch (error) {
    logger.error('Failed to send push notification', {
      endpoint: subscription.endpoint,
      error: error.message,
    });
    return { sent: false, reason: error.message };
  }
};

const buildTokenMintedContent = (token) => ({
  subject: `Token "${token.name}" minted successfully`,
  text: `Your token "${token.name}" (${token.symbol}) has been minted. Contract ID: ${token.contractId}`,
  html: `<h2>Token Minted Successfully</h2><p>Your token <strong>${token.name}</strong> (${token.symbol}) has been minted.</p><p>Contract ID: <code>${token.contractId}</code></p>`,
  pushPayload: {
    title: 'Token Minted',
    body: `"${token.name}" (${token.symbol}) deployed successfully`,
    data: { type: 'tokenMinted', contractId: token.contractId },
  },
});

const buildTransactionConfirmedContent = (contractId, txHash) => ({
  subject: `Transaction confirmed for ${contractId}`,
  text: `Transaction ${txHash} has been confirmed on the Stellar network for contract ${contractId}.`,
  html: `<h2>Transaction Confirmed</h2><p>Transaction <code>${txHash}</code> has been confirmed for contract <code>${contractId}</code>.</p>`,
  pushPayload: {
    title: 'Transaction Confirmed',
    body: `TX ${txHash.substring(0, 12)}... confirmed`,
    data: { type: 'transactionConfirmed', contractId, txHash },
  },
});

const buildDeploymentFailedContent = (tokenName, errorMessage) => ({
  subject: `Deployment failed for "${tokenName}"`,
  text: `Deployment of token "${tokenName}" failed: ${errorMessage}`,
  html: `<h2>Deployment Failed</h2><p>Deployment of token <strong>${tokenName}</strong> failed.</p><p>Error: ${errorMessage}</p>`,
  pushPayload: {
    title: 'Deployment Failed',
    body: `"${tokenName}" deployment failed`,
    data: { type: 'deploymentFailed', tokenName },
  },
});

const notifyUser = async (userId, eventType, contentBuilder) => {
  initNotificationService();

  try {
    const prefs = await NotificationPreferences.findByUserId(userId);

    if (!prefs.events[eventType]) {
      logger.info('Notification skipped — user disabled event', { userId, eventType });
      return;
    }

    const content = contentBuilder();

    if (prefs.email.enabled && prefs.email.address) {
      await sendEmail(prefs.email.address, content.subject, content.text, content.html);
    }

    if (prefs.webPush.enabled && prefs.webPush.subscription && prefs.webPush.subscription.endpoint) {
      await sendPushNotification(prefs.webPush.subscription, content.pushPayload);
    }
  } catch (error) {
    logger.error('Notification dispatch failed', { userId, eventType, error: error.message });
  }
};

module.exports = {
  initNotificationService,
  sendEmail,
  sendPushNotification,
  notifyUser,
  buildTokenMintedContent,
  buildTransactionConfirmedContent,
  buildDeploymentFailedContent,
};
