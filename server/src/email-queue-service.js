import { logger } from './logger.js';

/**
 * Email Notification Service Integration (#717)
 *
 * Provides email delivery for credential notifications, alerts, and system events.
 * Features queue-based reliability, delivery tracking, and unsubscribe management.
 */

/**
 * Email queue manager using Redis for reliable delivery.
 */
export class EmailQueueService {
  constructor(redisClient, config = {}) {
    this.redisClient = redisClient;
    this.config = {
      queueKey: 'email:queue',
      deliveryKey: 'email:delivered',
      maxRetries: config.maxRetries || 3,
      retryDelayMs: config.retryDelayMs || 5000,
      unsubscribeKey: 'email:unsubscribed',
      ...config,
    };
  }

  /**
   * Check if an email is on the unsubscribe list.
   * @param {string} email - Email address
   * @returns {Promise<boolean>}
   */
  async isUnsubscribed(email) {
    if (!this.redisClient) return false;
    try {
      const result = await this.redisClient.sismember(this.config.unsubscribeKey, email);
      return result === 1;
    } catch (err) {
      logger.error({
        msg: 'Failed to check unsubscribe status',
        error: err.message,
        email,
      });
      return false;
    }
  }

  /**
   * Add email to unsubscribe list.
   * @param {string} email - Email address
   * @returns {Promise<boolean>}
   */
  async unsubscribe(email) {
    if (!this.redisClient) return false;
    try {
      await this.redisClient.sadd(this.config.unsubscribeKey, email);
      logger.info({ msg: 'Email unsubscribed', email });
      return true;
    } catch (err) {
      logger.error({
        msg: 'Failed to unsubscribe email',
        error: err.message,
        email,
      });
      return false;
    }
  }

  /**
   * Queue an email for delivery.
   * @param {Object} message - Email message
   * @param {string} message.to - Recipient email
   * @param {string} message.type - Message type (credential_issued, expiry_warning, security_alert)
   * @param {string} message.subject - Subject line
   * @param {string} message.text - Plain text body
   * @param {string} [message.html] - HTML body
   * @param {Object} [message.metadata] - Additional metadata
   * @returns {Promise<string>} - Queue ID
   */
  async queueEmail(message) {
    if (!this.redisClient) {
      logger.warn({
        msg: 'Redis not available, email will not be queued',
        email: message.to,
        type: message.type,
      });
      return null;
    }

    // Check unsubscribe list
    if (await this.isUnsubscribed(message.to)) {
      logger.info({
        msg: 'Email not queued - recipient unsubscribed',
        email: message.to,
        type: message.type,
      });
      return null;
    }

    try {
      const queueId = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      const queueEntry = {
        id: queueId,
        to: message.to,
        type: message.type,
        subject: message.subject,
        text: message.text,
        html: message.html,
        metadata: message.metadata || {},
        retries: 0,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      await this.redisClient.lpush(
        this.config.queueKey,
        JSON.stringify(queueEntry)
      );

      logger.debug({
        msg: 'Email queued',
        queueId,
        email: message.to,
        type: message.type,
      });

      return queueId;
    } catch (err) {
      logger.error({
        msg: 'Failed to queue email',
        error: err.message,
        email: message.to,
        type: message.type,
      });
      return null;
    }
  }

  /**
   * Get pending emails from queue.
   * @param {number} count - Number of emails to retrieve
   * @returns {Promise<Array>}
   */
  async getPendingEmails(count = 10) {
    if (!this.redisClient) return [];
    
    try {
      const emails = await this.redisClient.lrange(this.config.queueKey, 0, count - 1);
      return emails.map(email => JSON.parse(email));
    } catch (err) {
      logger.error({
        msg: 'Failed to get pending emails',
        error: err.message,
      });
      return [];
    }
  }

  /**
   * Remove email from queue.
   * @param {string} queueId - Queue entry ID
   * @returns {Promise<boolean>}
   */
  async removeFromQueue(queueId) {
    if (!this.redisClient) return false;
    
    try {
      // This is simplified; in production use Lua script for atomicity
      const emails = await this.getPendingEmails(100);
      const filtered = emails.filter(e => e.id !== queueId);
      
      await this.redisClient.del(this.config.queueKey);
      if (filtered.length > 0) {
        await this.redisClient.rpush(
          this.config.queueKey,
          ...filtered.map(e => JSON.stringify(e))
        );
      }
      return true;
    } catch (err) {
      logger.error({
        msg: 'Failed to remove email from queue',
        error: err.message,
        queueId,
      });
      return false;
    }
  }

  /**
   * Record successful email delivery.
   * @param {string} email - Recipient email
   * @param {string} type - Message type
   * @param {Object} metadata - Delivery metadata
   * @returns {Promise<boolean>}
   */
  async recordDelivery(email, type, metadata = {}) {
    if (!this.redisClient) return false;

    try {
      const deliveryRecord = JSON.stringify({
        email,
        type,
        deliveredAt: Date.now(),
        ...metadata,
      });

      const key = `${this.config.deliveryKey}:${email}`;
      await this.redisClient.lpush(key, deliveryRecord);
      
      // Keep last 100 delivery records per email
      await this.redisClient.ltrim(key, 0, 99);
      
      // Set TTL to 90 days
      await this.redisClient.expire(key, 90 * 24 * 60 * 60);

      logger.debug({
        msg: 'Email delivery recorded',
        email,
        type,
      });

      return true;
    } catch (err) {
      logger.error({
        msg: 'Failed to record email delivery',
        error: err.message,
        email,
        type,
      });
      return false;
    }
  }

  /**
   * Get delivery history for an email.
   * @param {string} email - Recipient email
   * @returns {Promise<Array>}
   */
  async getDeliveryHistory(email) {
    if (!this.redisClient) return [];

    try {
      const key = `${this.config.deliveryKey}:${email}`;
      const records = await this.redisClient.lrange(key, 0, -1);
      return records.map(r => JSON.parse(r));
    } catch (err) {
      logger.error({
        msg: 'Failed to get delivery history',
        error: err.message,
        email,
      });
      return [];
    }
  }
}

/**
 * Credential issuance confirmation email template.
 */
export function renderCredentialIssuedSubject({ credentialType, issuer }) {
  return `New ${credentialType || 'credential'} from ${issuer || 'Soroban Identity'}`;
}

export function renderCredentialIssuedBody({ credential, credentialType, issuer, dashboardUrl }) {
  const issuedAt = new Date(credential.issuedAt * 1000).toLocaleString();
  const expiresAt = credential.expiresAt > 0
    ? new Date(credential.expiresAt * 1000).toLocaleString()
    : 'Never';

  const lines = [
    `Credential Type: ${credentialType || 'unspecified'}`,
    `Issuer: ${issuer || 'unknown'}`,
    `Issued At: ${issuedAt}`,
    `Expires At: ${expiresAt}`,
    `Credential ID: ${credential.id}`,
  ];

  const text = [
    `You have received a new ${credentialType || 'credential'} credential.`,
    '',
    ...lines,
    '',
    'Log in to your dashboard to view and manage your credentials.',
    dashboardUrl ? `${dashboardUrl}\n` : '',
    'If you did not request this credential, please contact the issuer.',
  ].join('\n');

  const html = [
    '<div style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">',
    `<h2>New ${escapeHtml(credentialType || 'Credential')} Received</h2>`,
    '<p>You have received a new credential from our identity service.</p>',
    '<ul>',
    ...lines.map(line => `<li>${escapeHtml(line)}</li>`),
    '</ul>',
    '<p><a href="' + escapeHtml(dashboardUrl || '#') + '">View in Dashboard</a></p>',
    '<p style="color: #666; font-size: 0.9em;">If you did not request this credential, please contact the issuer.</p>',
    '</div>',
  ].join('');

  return { text, html };
}

/**
 * Security alert email template.
 */
export function renderSecurityAlertSubject({ alertType }) {
  const types = {
    unauthorized_access: 'Unauthorized Access Attempt',
    credential_revocation: 'Credential Revoked',
    suspicious_activity: 'Suspicious Activity Detected',
    account_locked: 'Account Security Alert',
  };
  return types[alertType] || 'Security Alert';
}

export function renderSecurityAlertBody({ alertType, details, actionUrl, timestamp }) {
  const messages = {
    unauthorized_access: 'An unauthorized access attempt was detected on your account.',
    credential_revocation: 'One of your credentials has been revoked by the issuer.',
    suspicious_activity: 'Suspicious activity was detected on your account.',
    account_locked: 'Your account has been temporarily locked for security reasons.',
  };

  const message = messages[alertType] || 'A security alert has been triggered on your account.';
  const ts = timestamp ? new Date(timestamp).toLocaleString() : new Date().toLocaleString();

  const text = [
    message,
    '',
    `Timestamp: ${ts}`,
    ...(details ? [`Details: ${details}`] : []),
    '',
    'Please review your account activity and change your password if necessary.',
    actionUrl ? `Take Action: ${actionUrl}\n` : '',
    'If you did not authorize this action, please contact support immediately.',
  ].join('\n');

  const html = [
    '<div style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">',
    '<h2 style="color: #d32f2f;">Security Alert</h2>',
    `<p>${escapeHtml(message)}</p>`,
    '<ul>',
    `<li>Timestamp: ${escapeHtml(ts)}</li>`,
    ...(details ? [`<li>Details: ${escapeHtml(details)}</li>`] : []),
    '</ul>',
    '<p>Please review your account activity and change your password if necessary.</p>',
    actionUrl ? `<p><a href="${escapeHtml(actionUrl)}" style="background: #d32f2f; color: white; padding: 10px 20px; text-decoration: none; border-radius: 4px;">Take Action</a></p>` : '',
    '<p style="color: #666; font-size: 0.9em;">If you did not authorize this action, please contact support immediately.</p>',
    '</div>',
  ].join('');

  return { text, html };
}

/**
 * Unsubscribe footer template.
 */
export function renderUnsubscribeFooter({ unsubscribeUrl, email }) {
  const text = `\n\nTo unsubscribe from these notifications: ${unsubscribeUrl}?email=${encodeURIComponent(email || '')}`;
  const html = `<hr/><p style="font-size: 0.85em; color: #999;"><a href="${escapeHtml(unsubscribeUrl)}?email=${encodeURIComponent(email || '')}">Unsubscribe from notifications</a></p>`;
  return { text, html };
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
