import { logger } from './logger.js';

/**
 * Render the subject line for an expiry reminder.
 */
export function renderExpirySubject({ credentialType, daysRemaining }) {
  const label = credentialType ? `${credentialType} credential` : 'Credential';
  if (daysRemaining <= 0) return `${label} has expired`;
  if (daysRemaining === 1) return `${label} expires tomorrow`;
  return `${label} expires in ${daysRemaining} days`;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Render both the plain-text and HTML bodies for an expiry reminder.
 *
 * @param {object} params
 * @param {object} params.credential - Credential record
 * @param {number} params.daysRemaining
 * @param {number} params.threshold - Reminder threshold that triggered this send
 * @returns {{text: string, html: string}}
 */
export function renderExpiryBody({ credential, daysRemaining, threshold }) {
  const expiresAt = Number(credential.expires_at ?? credential.expiresAt ?? 0);
  const expiryDate = expiresAt > 0 ? new Date(expiresAt * 1000).toISOString() : 'unknown';

  const lines = [
    `Credential ID: ${credential.id}`,
    `Type: ${credential.credentialType ?? 'unspecified'}`,
    `Issuer: ${credential.issuer ?? 'unknown'}`,
    `Subject: ${credential.subject ?? 'unknown'}`,
    `Expires at: ${expiryDate}`,
    `Days remaining: ${daysRemaining}`,
    `Reminder threshold: ${threshold} day(s)`,
  ];

  const text = [
    daysRemaining <= 0
      ? 'One of your credentials has expired.'
      : `One of your credentials expires in ${daysRemaining} day(s).`,
    '',
    ...lines,
    '',
    'Renew or re-issue this credential to avoid verification failures.',
  ].join('\n');

  const html = [
    '<div>',
    `<p>${escapeHtml(
      daysRemaining <= 0
        ? 'One of your credentials has expired.'
        : `One of your credentials expires in ${daysRemaining} day(s).`,
    )}</p>`,
    '<ul>',
    ...lines.map((line) => `<li>${escapeHtml(line)}</li>`),
    '</ul>',
    '<p>Renew or re-issue this credential to avoid verification failures.</p>',
    '</div>',
  ].join('');

  return { text, html };
}

/**
 * Render the subject line for a quota threshold notification (#748).
 */
export function renderQuotaSubject({ tier, period, threshold }) {
  const pct = Math.round(threshold * 100);
  const periodLabel = period === 'daily' ? 'Daily' : 'Monthly';
  return pct >= 100
    ? `${periodLabel} API quota exhausted (${tier} tier)`
    : `${periodLabel} API quota at ${pct}% (${tier} tier)`;
}

/**
 * Render both the plain-text and HTML bodies for a quota threshold
 * notification, sent at 80% and 100% usage of a daily or monthly quota.
 */
export function renderQuotaBody({ tier, period, threshold, used, limit }) {
  const pct = Math.round(threshold * 100);
  const periodNoun = period === 'daily' ? 'day' : 'month';
  const summary = pct >= 100
    ? `Your API key has used its entire ${period} quota.`
    : `Your API key has reached ${pct}% of its ${period} quota.`;
  const action = pct >= 100
    ? `Requests will be limited until the quota resets at the start of the next ${periodNoun}.`
    : 'Consider upgrading your tier if you expect to exceed this limit.';

  const lines = [
    `Tier: ${tier}`,
    `Period: ${period}`,
    `Usage: ${used} / ${limit} requests`,
    `Threshold crossed: ${pct}%`,
  ];

  const text = [summary, '', ...lines, '', action].join('\n');
  const html = [
    '<div>',
    `<p>${escapeHtml(summary)}</p>`,
    '<ul>',
    ...lines.map((line) => `<li>${escapeHtml(line)}</li>`),
    '</ul>',
    `<p>${escapeHtml(action)}</p>`,
    '</div>',
  ].join('');

  return { text, html };
}

/**
 * Render the subject line for a deprecated-endpoint usage notification (#751).
 */
export function renderDeprecationSubject(rule) {
  return `Deprecated API endpoint in use: ${rule.name}`;
}

/**
 * Render both the plain-text and HTML bodies for a deprecated-endpoint usage
 * notification, sent at most once per API key per endpoint per day.
 */
export function renderDeprecationBody(rule) {
  const summary = rule.description ?? 'One of your API keys is calling a deprecated endpoint.';
  const lines = [
    `Endpoint: ${rule.method ?? 'ANY'} ${rule.name}`,
    `Deprecated since: ${rule.deprecatedSince}`,
    `Sunset date: ${rule.sunsetDate}`,
    `Migration guide: ${rule.migrationUrl}`,
  ];

  const text = [summary, '', ...lines, '', 'Please migrate before the sunset date to avoid disruption.'].join('\n');
  const html = [
    '<div>',
    `<p>${escapeHtml(summary)}</p>`,
    '<ul>',
    ...lines.map((line) => `<li>${escapeHtml(line)}</li>`),
    '</ul>',
    '<p>Please migrate before the sunset date to avoid disruption.</p>',
    '</div>',
  ].join('');

  return { text, html };
}

/**
 * HTTP-API email transport.
 *
 * Deliberately provider-agnostic: it POSTs a JSON message to
 * `EMAIL_API_URL` with an optional bearer token. This keeps the server free of
 * an SMTP dependency while working against SendGrid-style, Mailgun-style, or
 * in-house relay endpoints behind a thin adapter.
 */
export class EmailTransport {
  constructor(config, { fetchImpl = fetch } = {}) {
    this.config = config;
    this.fetchImpl = fetchImpl;
  }

  get enabled() {
    return Boolean(this.config.emailApiUrl && this.config.emailFrom);
  }

  /**
   * Send one email.
   *
   * @param {object} message
   * @param {string} message.to
   * @param {string} message.subject
   * @param {string} message.text
   * @param {string} [message.html]
   * @returns {Promise<{status:number, durationMs:number}>}
   */
  async send({ to, subject, text, html }) {
    if (!this.enabled) {
      throw new Error('Email transport is not configured (set EMAIL_API_URL and EMAIL_FROM)');
    }
    if (!to) throw new Error('Email recipient is required');

    const headers = { 'content-type': 'application/json' };
    if (this.config.emailApiKey) {
      headers.authorization = `Bearer ${this.config.emailApiKey}`;
    }

    const body = JSON.stringify({
      from: this.config.emailFrom,
      to,
      subject,
      text,
      html,
    });

    const startTime = Date.now();
    const response = await this.fetchImpl(this.config.emailApiUrl, {
      method: 'POST',
      headers,
      body,
    });
    const durationMs = Date.now() - startTime;

    if (!response.ok) {
      logger.error({ to, subject, status: response.status, durationMs }, 'Email delivery failed');
      throw new Error(`email dispatch failed with HTTP ${response.status}`);
    }

    logger.info({ to, subject, status: response.status, durationMs }, 'Email delivered');
    return { status: response.status, durationMs };
  }
}

/**
 * Resolve the notification email address for a credential.
 *
 * Precedence: per-credential address, then the configured per-subject map,
 * then the global fallback address.
 */
export function resolveRecipient(config, credential) {
  return (
    credential.notificationEmail ??
    credential.notification_email ??
    config.subjectNotificationEmails?.[credential.subject] ??
    config.notificationEmail ??
    null
  );
}

/**
 * Send credential issuance confirmation email.
 * @param {Object} params
 * @param {EmailTransport} params.transport - Email transport instance
 * @param {string} params.recipientEmail - Recipient email address
 * @param {Object} params.credential - Credential object
 * @param {string} [params.credentialType] - Credential type label
 * @param {string} [params.issuer] - Issuer name or DID
 * @param {string} [params.dashboardUrl] - URL to dashboard
 * @returns {Promise<Object>} - Send result
 */
export async function sendCredentialIssuedNotification({
  transport,
  recipientEmail,
  credential,
  credentialType = 'credential',
  issuer = 'Soroban Identity',
  dashboardUrl = null,
}) {
  if (!transport?.enabled) {
    logger.warn({ recipientEmail, credentialType }, 'Email transport not enabled');
    return { sent: false, reason: 'email_transport_disabled' };
  }

  if (!recipientEmail) {
    logger.warn({ credentialType }, 'No recipient email provided');
    return { sent: false, reason: 'no_recipient' };
  }

  try {
    const subject = renderCredentialIssuedSubject({ credentialType, issuer });
    const { text, html } = renderCredentialIssuedBody({
      credential,
      credentialType,
      issuer,
      dashboardUrl,
    });

    const result = await transport.send({ to: recipientEmail, subject, text, html });
    logger.info({
      msg: 'Credential issuance notification sent',
      email: recipientEmail,
      credentialType,
      durationMs: result.durationMs,
    });

    return { sent: true, ...result };
  } catch (err) {
    logger.error({
      msg: 'Failed to send credential issuance notification',
      error: err.message,
      email: recipientEmail,
      credentialType,
    });
    return { sent: false, reason: err.message };
  }
}

/**
 * Send security alert email.
 * @param {Object} params
 * @param {EmailTransport} params.transport - Email transport instance
 * @param {string} params.recipientEmail - Recipient email address
 * @param {string} params.alertType - Alert type
 * @param {string} [params.details] - Alert details
 * @param {string} [params.actionUrl] - URL to take action
 * @param {number} [params.timestamp] - Alert timestamp
 * @returns {Promise<Object>} - Send result
 */
export async function sendSecurityAlert({
  transport,
  recipientEmail,
  alertType = 'suspicious_activity',
  details = null,
  actionUrl = null,
  timestamp = null,
}) {
  if (!transport?.enabled) {
    logger.warn({ recipientEmail, alertType }, 'Email transport not enabled');
    return { sent: false, reason: 'email_transport_disabled' };
  }

  if (!recipientEmail) {
    logger.warn({ alertType }, 'No recipient email provided');
    return { sent: false, reason: 'no_recipient' };
  }

  try {
    const subject = renderSecurityAlertSubject({ alertType });
    const { text, html } = renderSecurityAlertBody({
      alertType,
      details,
      actionUrl,
      timestamp: timestamp || Date.now(),
    });

    const result = await transport.send({ to: recipientEmail, subject, text, html });
    logger.info({
      msg: 'Security alert sent',
      email: recipientEmail,
      alertType,
      durationMs: result.durationMs,
    });

    return { sent: true, ...result };
  } catch (err) {
    logger.error({
      msg: 'Failed to send security alert',
      error: err.message,
      email: recipientEmail,
      alertType,
    });
    return { sent: false, reason: err.message };
  }
}

/**
 * Render credential issuance confirmation subject.
 */
function renderCredentialIssuedSubject({ credentialType, issuer }) {
  return `New ${credentialType || 'credential'} from ${issuer || 'Soroban Identity'}`;
}

/**
 * Render credential issuance confirmation body.
 */
function renderCredentialIssuedBody({ credential, credentialType, issuer, dashboardUrl }) {
  const issuedAt = new Date(credential.issuedAt * 1000 || credential.issued_at * 1000 || Date.now()).toLocaleString();
  const expiresAt = credential.expiresAt > 0 || credential.expires_at > 0
    ? new Date((credential.expiresAt || credential.expires_at) * 1000).toLocaleString()
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
 * Render security alert subject.
 */
function renderSecurityAlertSubject({ alertType }) {
  const types = {
    unauthorized_access: 'Unauthorized Access Attempt',
    credential_revocation: 'Credential Revoked',
    suspicious_activity: 'Suspicious Activity Detected',
    account_locked: 'Account Security Alert',
  };
  return types[alertType] || 'Security Alert';
}

/**
 * Render security alert body.
 */
function renderSecurityAlertBody({ alertType, details, actionUrl, timestamp }) {
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
