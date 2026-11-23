import { createHash, randomUUID } from 'crypto';

/**
 * Email notification service (BE-11).
 *
 * Sends credential expiry and revocation notifications through a pluggable
 * email provider (SendGrid-compatible HTTP API by default). Emails are queued
 * through the existing job system instead of being sent inline, delivery
 * status is tracked, and every message carries an unsubscribe link.
 */

export type EmailTemplate = 'credential-expiry' | 'credential-revocation';

export type DeliveryStatus =
  | 'queued'
  | 'sending'
  | 'delivered'
  | 'failed'
  | 'unsubscribed';

export interface CredentialEmailContext {
  recipient: string;
  credentialName: string;
  credentialId: string;
  /** ISO-8601 timestamp of when the credential expires. */
  expiresAt?: string;
  /** ISO-8601 timestamp of when the credential was revoked. */
  revokedAt?: string;
  reason?: string;
}

export interface EmailMessage {
  id: string;
  template: EmailTemplate;
  to: string;
  subject: string;
  html: string;
  text: string;
  unsubscribeUrl: string;
  status: DeliveryStatus;
  attempts: number;
  createdAt: string;
  updatedAt: string;
  error?: string;
}

export interface EmailJob {
  id: string;
  type: 'email.send';
  payload: { messageId: string };
  enqueuedAt: string;
}

/** Minimal contract for the existing job system. */
export interface JobQueue {
  enqueue(job: EmailJob): Promise<void> | void;
}

/** Minimal contract for the email delivery provider (e.g. SendGrid). */
export interface EmailProvider {
  send(message: EmailMessage): Promise<{ providerMessageId: string }>;
}

export interface EmailServiceOptions {
  queue: JobQueue;
  provider: EmailProvider;
  /** Base URL used to build unsubscribe links. */
  unsubscribeBaseUrl: string;
  /** Optional clock injection for deterministic tests. */
  now?: () => Date;
}

const TEMPLATES: Record<
  EmailTemplate,
  (ctx: CredentialEmailContext) => { subject: string; html: string; text: string }
> = {
  'credential-expiry': (ctx) => {
    const when = ctx.expiresAt ?? 'soon';
    const subject = `Credential "${ctx.credentialName}" is expiring`;
    const text = [
      `Hello,`,
      ``,
      `Your credential "${ctx.credentialName}" (${ctx.credentialId}) will expire on ${when}.`,
      `Please rotate or renew it to avoid service interruption.`,
      ``,
      `If you did not expect this message you can unsubscribe using the link below.`,
    ].join('\n');
    const html = [
      `<p>Hello,</p>`,
      `<p>Your credential <strong>${escapeHtml(ctx.credentialName)}</strong> ` +
        `(<code>${escapeHtml(ctx.credentialId)}</code>) will expire on ` +
        `<strong>${escapeHtml(when)}</strong>.</p>`,
      `<p>Please rotate or renew it to avoid service interruption.</p>`,
    ].join('\n');
    return { subject, html, text };
  },
  'credential-revocation': (ctx) => {
    const when = ctx.revokedAt ?? 'just now';
    const reason = ctx.reason ? ` Reason: ${ctx.reason}.` : '';
    const subject = `Credential "${ctx.credentialName}" was revoked`;
    const text = [
      `Hello,`,
      ``,
      `Your credential "${ctx.credentialName}" (${ctx.credentialId}) was revoked on ${when}.${reason}`,
      `If this was not expected, contact your administrator immediately.`,
      ``,
      `If you did not expect this message you can unsubscribe using the link below.`,
    ].join('\n');
    const html = [
      `<p>Hello,</p>`,
      `<p>Your credential <strong>${escapeHtml(ctx.credentialName)}</strong> ` +
        `(<code>${escapeHtml(ctx.credentialId)}</code>) was revoked on ` +
        `<strong>${escapeHtml(when)}</strong>.${ctx.reason ? ` Reason: ${escapeHtml(ctx.reason)}.` : ''}</p>`,
      `<p>If this was not expected, contact your administrator immediately.</p>`,
    ].join('\n');
    return { subject, html, text };
  },
};

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function unsubscribeToken(email: string): string {
  return createHash('sha256').update(email.trim().toLowerCase()).digest('hex').slice(0, 32);
}

export class EmailNotificationService {
  private readonly queue: JobQueue;
  private readonly provider: EmailProvider;
  private readonly unsubscribeBaseUrl: string;
  private readonly now: () => Date;
  private readonly messages = new Map<string, EmailMessage>();
  private readonly unsubscribed = new Set<string>();

  constructor(options: EmailServiceOptions) {
    this.queue = options.queue;
    this.provider = options.provider;
    this.unsubscribeBaseUrl = options.unsubscribeBaseUrl.replace(/\/$/, '');
    this.now = options.now ?? (() => new Date());
  }

  /** Render a template without queueing it (used for previews and tests). */
  render(template: EmailTemplate, ctx: CredentialEmailContext): EmailMessage {
    const rendered = TEMPLATES[template](ctx);
    const timestamp = this.now().toISOString();
    return {
      id: randomUUID(),
      template,
      to: ctx.recipient,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
      unsubscribeUrl: this.buildUnsubscribeUrl(ctx.recipient),
      status: 'queued',
      attempts: 0,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
  }

  /** Queue a credential expiry notification through the job system. */
  async queueExpiryNotification(ctx: CredentialEmailContext): Promise<EmailMessage> {
    return this.enqueue('credential-expiry', ctx);
  }

  /** Queue a credential revocation notification through the job system. */
  async queueRevocationNotification(ctx: CredentialEmailContext): Promise<EmailMessage> {
    return this.enqueue('credential-revocation', ctx);
  }

  private async enqueue(
    template: EmailTemplate,
    ctx: CredentialEmailContext,
  ): Promise<EmailMessage> {
    const message = this.render(template, ctx);
    if (this.isUnsubscribed(ctx.recipient)) {
      message.status = 'unsubscribed';
      this.messages.set(message.id, message);
      return message;
    }
    this.messages.set(message.id, message);
    await this.queue.enqueue({
      id: randomUUID(),
      type: 'email.send',
      payload: { messageId: message.id },
      enqueuedAt: this.now().toISOString(),
    });
    return message;
  }

  /** Job worker entry point: deliver a previously queued message. */
  async processJob(job: EmailJob): Promise<EmailMessage | undefined> {
    const message = this.messages.get(job.payload.messageId);
    if (!message) {
      return undefined;
    }
    if (this.isUnsubscribed(message.to)) {
      return this.updateStatus(message, 'unsubscribed');
    }
    this.updateStatus(message, 'sending');
    message.attempts += 1;
    try {
      await this.provider.send(message);
      return this.updateStatus(message, 'delivered');
    } catch (error) {
      message.error = error instanceof Error ? error.message : String(error);
      return this.updateStatus(message, 'failed');
    }
  }

  /** Delivery status lookup for a queued or sent message. */
  getStatus(messageId: string): DeliveryStatus | undefined {
    return this.messages.get(messageId)?.status;
  }

  getMessage(messageId: string): EmailMessage | undefined {
    return this.messages.get(messageId);
  }

  /** Record an unsubscribe request for a recipient address. */
  unsubscribe(email: string): void {
    this.unsubscribed.add(email.trim().toLowerCase());
  }

  isUnsubscribed(email: string): boolean {
    return this.unsubscribed.has(email.trim().toLowerCase());
  }

  buildUnsubscribeUrl(email: string): string {
    return `${this.unsubscribeBaseUrl}/unsubscribe?token=${unsubscribeToken(email)}`;
  }

  private updateStatus(message: EmailMessage, status: DeliveryStatus): EmailMessage {
    message.status = status;
    message.updatedAt = this.now().toISOString();
    this.messages.set(message.id, message);
    return message;
  }
}
