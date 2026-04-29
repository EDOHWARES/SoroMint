/**
 * @title Alert Service (Discord/Slack)
 * @description Sends notifications to Discord and Slack webhooks for anomalies
 * @notice Admin notifications for suspicious activity
 */

const axios = require('axios');
const { getEnv } = require('../config/env-config');
const { logger } = require('../utils/logger');

class AlertService {
  constructor() {
    this.env = getEnv();
    this.discordWebhook = this.env.DISCORD_WEBHOOK_URL;
    this.slackWebhook = this.env.SLACK_WEBHOOK_URL;
  }

  /**
   * Send alert to Discord
   * @param {Object} alert - Alert object
   * @returns {Promise<boolean>}
   */
  async sendDiscordAlert(alert) {
    if (!this.discordWebhook) {
      logger.warn('Discord webhook URL not configured');
      return false;
    }

    try {
      const color = this._getSeverityColor(alert.severity);
      const embed = {
        title: `🚨 ${this._formatAlertType(alert.alertType)}`,
        description: alert.description,
        color,
        fields: [
          {
            name: 'Severity',
            value: alert.severity.toUpperCase(),
            inline: true,
          },
          {
            name: 'User ID',
            value: alert.userId,
            inline: true,
          },
          {
            name: 'Alert ID',
            value: alert._id.toString(),
            inline: false,
          },
          {
            name: 'Details',
            value: '```json\n' + JSON.stringify(alert.details, null, 2).substring(0, 200) + '\n```',
            inline: false,
          },
        ],
        timestamp: new Date(),
        footer: {
          text: 'SoroMint Fraud Detection System',
        },
      };

      await axios.post(this.discordWebhook, {
        content: this._getAlertMention(alert.severity),
        embeds: [embed],
      });

      logger.info('Discord alert sent', { alertId: alert._id, severity: alert.severity });
      return true;
    } catch (error) {
      logger.error('Error sending Discord alert', { error: error.message });
      return false;
    }
  }

  /**
   * Send alert to Slack
   * @param {Object} alert - Alert object
   * @returns {Promise<boolean>}
   */
  async sendSlackAlert(alert) {
    if (!this.slackWebhook) {
      logger.warn('Slack webhook URL not configured');
      return false;
    }

    try {
      const color = this._getSeverityColorHex(alert.severity);
      const block = {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*🚨 ${this._formatAlertType(alert.alertType)}*\n${alert.description}`,
        },
      };

      const divider = {
        type: 'divider',
      };

      const fields = {
        type: 'section',
        fields: [
          {
            type: 'mrkdwn',
            text: `*Severity:*\n${alert.severity.toUpperCase()}`,
          },
          {
            type: 'mrkdwn',
            text: `*User ID:*\n${alert.userId}`,
          },
          {
            type: 'mrkdwn',
            text: `*Alert ID:*\n\`${alert._id.toString()}\``,
          },
          {
            type: 'mrkdwn',
            text: `*Time:*\n${new Date(alert.createdAt).toISOString()}`,
          },
        ],
      };

      const context = {
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: `SoroMint Fraud Detection System • ${alert.severity}`,
          },
        ],
      };

      await axios.post(this.slackWebhook, {
        blocks: [block, divider, fields, context],
        attachments: [
          {
            color,
            mrkdwn_in: ['text', 'pretext'],
          },
        ],
      });

      logger.info('Slack alert sent', { alertId: alert._id, severity: alert.severity });
      return true;
    } catch (error) {
      logger.error('Error sending Slack alert', { error: error.message });
      return false;
    }
  }

  /**
   * Send alert to both Discord and Slack
   * @param {Object} alert - Alert object
   * @returns {Promise<Object>} Results
   */
  async broadcastAlert(alert) {
    const results = {
      discord: false,
      slack: false,
    };

    if (alert.notificationChannels?.discord !== false) {
      results.discord = await this.sendDiscordAlert(alert);
    }

    if (alert.notificationChannels?.slack !== false) {
      results.slack = await this.sendSlackAlert(alert);
    }

    return results;
  }

  /**
   * Get severity color for Discord embeds
   * @private
   */
  _getSeverityColor(severity) {
    const colors = {
      critical: 16711680, // Red
      high: 16744192, // Orange
      medium: 16776960, // Yellow
      low: 65280, // Green
    };
    return colors[severity] || 16711680;
  }

  /**
   * Get severity color for Slack (hex)
   * @private
   */
  _getSeverityColorHex(severity) {
    const colors = {
      critical: '#FF0000',
      high: '#FF8800',
      medium: '#FFFF00',
      low: '#00FF00',
    };
    return colors[severity] || '#FF0000';
  }

  /**
   * Get mention string based on severity
   * @private
   */
  _getAlertMention(severity) {
    if (severity === 'critical') {
      return '@channel CRITICAL FRAUD ALERT';
    } else if (severity === 'high') {
      return '@here High Severity Alert';
    }
    return 'New Anomaly Detected';
  }

  /**
   * Format alert type to readable string
   * @private
   */
  _formatAlertType(type) {
    const formats = {
      rapid_stream_cycles: 'Rapid Stream-Withdraw-Cancel Cycles',
      excessive_withdrawals: 'Excessive Withdrawal Attempts',
      rapid_cancel_withdraw: 'Rapid Cancel/Withdraw Operations',
      unusual_volume: 'Unusual Transaction Volume',
      rate_limit_abuse: 'Rate Limit Abuse',
      suspicious_pattern: 'Suspicious Pattern Detected',
    };
    return formats[type] || type;
  }

  /**
   * Send bulk alert summary
   * @param {Array} alerts - Array of alerts
   * @returns {Promise<Object>}
   */
  async sendBulkAlertSummary(alerts) {
    if (alerts.length === 0) return { discord: false, slack: false };

    const criticalCount = alerts.filter((a) => a.severity === 'critical').length;
    const highCount = alerts.filter((a) => a.severity === 'high').length;
    const mediumCount = alerts.filter((a) => a.severity === 'medium').length;

    const summaryAlert = {
      _id: 'summary',
      severity: criticalCount > 0 ? 'critical' : highCount > 0 ? 'high' : 'medium',
      alertType: 'suspicious_pattern',
      userId: 'SYSTEM',
      description: `Batch Alert Summary: ${alerts.length} anomalies detected`,
      details: {
        critical: criticalCount,
        high: highCount,
        medium: mediumCount,
        total: alerts.length,
      },
      notificationChannels: {
        discord: true,
        slack: true,
      },
      createdAt: new Date(),
    };

    return this.broadcastAlert(summaryAlert);
  }
}

module.exports = AlertService;
