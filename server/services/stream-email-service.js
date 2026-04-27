/**
 * Stream Email Notification Service
 * Sends async email notifications for stream lifecycle events via BullMQ queue.
 * Integrates with the existing SendGrid-backed notification-service.
 */

const { Queue, Worker } = require('bullmq');
const Redis = require('ioredis');
const { sendEmail } = require('./notification-service');
const NotificationPreferences = require('../models/NotificationPreferences');
const User = require('../models/User');
const { logger } = require('../utils/logger');

const connection = new Redis(process.env.REDIS_URL || 'redis://127.0.0.1:6379', {
  maxRetriesPerRequest: null,
});

const QUEUE_NAME = 'stream-email-notifications';

const streamEmailQueue = new Queue(QUEUE_NAME, { connection });

// ─── Email Templates ──────────────────────────────────────────────────────────

const templates = {
  stream_created: (data) => ({
    subject: `A new payment stream has been created for you`,
    text: `Hello,\n\nA payment stream has been created for you by ${data.sender}.\n\nDetails:\n- Token: ${data.tokenAddress}\n- Total Amount: ${data.totalAmount}\n- Stream ID: ${data.streamId}\n\nYou can view your stream on SoroMint.\n\nRegards,\nThe SoroMint Team`,
    html: `
      <div style="font-family:sans-serif;max-width:600px;margin:auto">
        <h2 style="color:#6366f1">New Payment Stream Created</h2>
        <p>A payment stream has been created for you.</p>
        <table style="width:100%;border-collapse:collapse">
          <tr><td style="padding:8px;border:1px solid #e5e7eb"><strong>Sender</strong></td><td style="padding:8px;border:1px solid #e5e7eb">${data.sender}</td></tr>
          <tr><td style="padding:8px;border:1px solid #e5e7eb"><strong>Token</strong></td><td style="padding:8px;border:1px solid #e5e7eb">${data.tokenAddress}</td></tr>
          <tr><td style="padding:8px;border:1px solid #e5e7eb"><strong>Total Amount</strong></td><td style="padding:8px;border:1px solid #e5e7eb">${data.totalAmount}</td></tr>
          <tr><td style="padding:8px;border:1px solid #e5e7eb"><strong>Stream ID</strong></td><td style="padding:8px;border:1px solid #e5e7eb">${data.streamId}</td></tr>
        </table>
        <p style="margin-top:16px;color:#6b7280;font-size:12px">You are receiving this because you opted in to stream notifications. <a href="${process.env.APP_URL || 'https://soromint.io'}/settings/notifications">Manage preferences</a></p>
      </div>`,
  }),

  funds_received: (data) => ({
    subject: `You received funds from a payment stream`,
    text: `Hello,\n\nYou have received ${data.amount} tokens from stream ${data.streamId} (sender: ${data.sender}).\n\nRegards,\nThe SoroMint Team`,
    html: `
      <div style="font-family:sans-serif;max-width:600px;margin:auto">
        <h2 style="color:#6366f1">Funds Received</h2>
        <p>You have received funds from a payment stream.</p>
        <table style="width:100%;border-collapse:collapse">
          <tr><td style="padding:8px;border:1px solid #e5e7eb"><strong>Amount</strong></td><td style="padding:8px;border:1px solid #e5e7eb">${data.amount}</td></tr>
          <tr><td style="padding:8px;border:1px solid #e5e7eb"><strong>Sender</strong></td><td style="padding:8px;border:1px solid #e5e7eb">${data.sender}</td></tr>
          <tr><td style="padding:8px;border:1px solid #e5e7eb"><strong>Stream ID</strong></td><td style="padding:8px;border:1px solid #e5e7eb">${data.streamId}</td></tr>
        </table>
        <p style="margin-top:16px;color:#6b7280;font-size:12px"><a href="${process.env.APP_URL || 'https://soromint.io'}/settings/notifications">Manage preferences</a></p>
      </div>`,
  }),

  stream_cancelled: (data) => ({
    subject: `Payment stream ${data.streamId} has been cancelled`,
    text: `Hello,\n\nThe payment stream ${data.streamId} from ${data.sender} has been cancelled.\n\nRegards,\nThe SoroMint Team`,
    html: `
      <div style="font-family:sans-serif;max-width:600px;margin:auto">
        <h2 style="color:#ef4444">Stream Cancelled</h2>
        <p>A payment stream directed to you has been cancelled.</p>
        <table style="width:100%;border-collapse:collapse">
          <tr><td style="padding:8px;border:1px solid #e5e7eb"><strong>Stream ID</strong></td><td style="padding:8px;border:1px solid #e5e7eb">${data.streamId}</td></tr>
          <tr><td style="padding:8px;border:1px solid #e5e7eb"><strong>Sender</strong></td><td style="padding:8px;border:1px solid #e5e7eb">${data.sender}</td></tr>
        </table>
        <p style="margin-top:16px;color:#6b7280;font-size:12px"><a href="${process.env.APP_URL || 'https://soromint.io'}/settings/notifications">Manage preferences</a></p>
      </div>`,
  }),
};

// ─── Queue Worker ─────────────────────────────────────────────────────────────

const streamEmailWorker = new Worker(
  QUEUE_NAME,
  async (job) => {
    const { recipientAddress, eventType, data } = job.data;

    // Look up user by Stellar public key
    const user = await User.findOne({ publicKey: recipientAddress });
    if (!user) {
      logger.warn('Stream email: no user found for address', { recipientAddress, eventType });
      return { skipped: true, reason: 'user_not_found' };
    }

    // Check notification preferences
    const prefs = await NotificationPreferences.findByUserId(user._id);

    const eventKey = `stream_${eventType}`;
    if (!prefs.email.enabled || !prefs.email.address) {
      logger.info('Stream email: user has email notifications disabled', { userId: user._id, eventType });
      return { skipped: true, reason: 'email_disabled' };
    }

    // Check per-event opt-in (fall back to enabled if key not present)
    if (prefs.events[eventKey] === false) {
      logger.info('Stream email: user opted out of event', { userId: user._id, eventKey });
      return { skipped: true, reason: 'event_opted_out' };
    }

    const templateFn = templates[eventKey];
    if (!templateFn) {
      logger.warn('Stream email: unknown event type', { eventType });
      return { skipped: true, reason: 'unknown_event' };
    }

    const { subject, text, html } = templateFn(data);
    const result = await sendEmail(prefs.email.address, subject, text, html);

    logger.info('Stream email dispatched', { userId: user._id, eventType, result });
    return result;
  },
  {
    connection,
    concurrency: 5,
    attempts: 3,
    backoff: { type: 'exponential', delay: 3000 },
  }
);

streamEmailWorker.on('failed', (job, err) => {
  logger.error('Stream email job failed', { jobId: job?.id, error: err.message });
});

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Enqueue a stream notification email.
 * @param {'created'|'funds_received'|'cancelled'} eventType
 * @param {string} recipientAddress - Stellar public key of the recipient
 * @param {object} data - Template data (streamId, sender, amount, etc.)
 */
async function enqueueStreamEmail(eventType, recipientAddress, data) {
  const job = await streamEmailQueue.add(
    eventType,
    { recipientAddress, eventType, data },
    { attempts: 3, backoff: { type: 'exponential', delay: 3000 } }
  );
  logger.info('Stream email enqueued', { jobId: job.id, eventType, recipientAddress });
  return job.id;
}

module.exports = { enqueueStreamEmail, streamEmailQueue };
