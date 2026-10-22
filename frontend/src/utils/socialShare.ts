import type { Credential } from '../../../sdk/src/types';
import { trackShareEvent } from './credentialCrypto';

export type SocialPlatform = 'twitter' | 'linkedin' | 'facebook' | 'whatsapp' | 'native' | 'copy';

/**
 * How much of the credential a share reveals.
 * - `public`: type and issuer may be shown in the share text.
 * - `private`: nothing beyond the verification link is shared.
 * - `selective`: only the fields the user explicitly enabled are shared.
 */
export type SharePrivacyMode = 'public' | 'private' | 'selective';

/** Resolve the effective field-level privacy options for a given mode. */
export function resolvePrivacyForMode(
  mode: SharePrivacyMode,
  options: SharePrivacyOptions = DEFAULT_PRIVACY
): SharePrivacyOptions {
  switch (mode) {
    case 'public':
      return { includeType: true, includeIssuer: true, includeIdInAnalytics: options.includeIdInAnalytics };
    case 'private':
      return { includeType: false, includeIssuer: false, includeIdInAnalytics: false };
    case 'selective':
      return { ...options };
  }
}

/** What the user has agreed to reveal in a public share. */
export interface SharePrivacyOptions {
  /** Mention the credential type (e.g. "KYC") in the share text. */
  includeType: boolean;
  /** Mention the issuer address in the share text. */
  includeIssuer: boolean;
  /** Record the credential ID in local share analytics. Off = platform only. */
  includeIdInAnalytics: boolean;
}

export const DEFAULT_PRIVACY: SharePrivacyOptions = {
  includeType: true,
  includeIssuer: false,
  includeIdInAnalytics: false,
};

const PRIVACY_STORAGE_KEY = 'soroban_social_share_privacy';

export function loadPrivacyOptions(): SharePrivacyOptions {
  try {
    const raw = localStorage.getItem(PRIVACY_STORAGE_KEY);
    return raw ? { ...DEFAULT_PRIVACY, ...(JSON.parse(raw) as Partial<SharePrivacyOptions>) } : DEFAULT_PRIVACY;
  } catch {
    return DEFAULT_PRIVACY;
  }
}

export function savePrivacyOptions(options: SharePrivacyOptions): void {
  try {
    localStorage.setItem(PRIVACY_STORAGE_KEY, JSON.stringify(options));
  } catch {
    // Storage unavailable (private mode); preferences just won't persist.
  }
}

const TYPE_LABELS: Record<string, string> = {
  Kyc: 'KYC',
  Reputation: 'reputation',
  Achievement: 'achievement',
  Custom: 'verifiable',
};

function shortAddress(address: string): string {
  return address.length > 12 ? `${address.slice(0, 5)}…${address.slice(-4)}` : address;
}

/**
 * Public verification URL for a credential. It reuses the app's existing
 * `?verify=<id>` deep link, so opening it runs an on-chain verification. Only
 * the credential ID is included, never claims. UTM parameters identify the
 * platform for analytics.
 */
export function buildVerificationUrl(credentialId: string, platform?: SocialPlatform, base?: string): string {
  const url = new URL(base ?? window.location.origin + window.location.pathname);
  url.search = '';
  url.hash = '';
  url.searchParams.set('verify', credentialId);
  if (platform && platform !== 'copy') {
    url.searchParams.set('utm_source', platform);
    url.searchParams.set('utm_medium', 'social');
    url.searchParams.set('utm_campaign', 'credential_share');
  }
  return url.toString();
}

/** Human-readable share text, limited to what the privacy options allow. */
export function buildShareText(credential: Pick<Credential, 'credentialType' | 'issuer'>, privacy: SharePrivacyOptions): string {
  const kind = privacy.includeType ? `${TYPE_LABELS[credential.credentialType] ?? 'verifiable'} credential` : 'credential';
  const issuer = privacy.includeIssuer ? ` issued by ${shortAddress(credential.issuer)}` : '';
  return `I hold a ${kind}${issuer} on Soroban Identity. Verify it on-chain:`;
}

export const SHARE_TITLE = 'Verified credential on Soroban Identity';
export const SHARE_DESCRIPTION =
  'Verify this credential directly on the Stellar network. No personal claims are shared.';

/**
 * Platform share intent URLs. These are the official web share endpoints,
 * so no third-party SDK scripts load and nothing is sent to a platform until
 * the user clicks.
 */
export function buildPlatformUrl(platform: 'twitter' | 'linkedin' | 'facebook' | 'whatsapp', url: string, text: string): string {
  switch (platform) {
    case 'twitter':
      return `https://twitter.com/intent/tweet?${new URLSearchParams({ text, url, hashtags: 'SorobanIdentity,Stellar' })}`;
    case 'linkedin':
      return `https://www.linkedin.com/sharing/share-offsite/?${new URLSearchParams({ url })}`;
    case 'facebook':
      return `https://www.facebook.com/sharer/sharer.php?${new URLSearchParams({ u: url })}`;
    case 'whatsapp':
      return `https://wa.me/?${new URLSearchParams({ text: `${text} ${url}` })}`;
  }
}

/** Shape returned by the server when a short link is created. */
export interface ShortLink {
  id: string;
  url: string;
  /** ISO timestamp of when the short link expires, if any. */
  expiresAt?: string;
}

/** Shape returned by the server when a short link is resolved. */
export interface ResolvedShortLink {
  credentialId: string;
  /** Public verification URL the short link redirects to. */
  verificationUrl: string;
  /** Whether the credential is still verifiable on-chain. */
  verified?: boolean;
}

function apiBase(): string {
  const base = (import.meta as { env?: Record<string, string> }).env?.VITE_API_URL;
  return (base ?? '').replace(/\/$/, '');
}

/**
 * Create a short link for a share URL via the server's `/share/shorten`
 * endpoint. Falls back to the original URL if shortening fails, so sharing
 * never breaks because of a backend hiccup.
 */
export async function shortenShareUrl(url: string): Promise<string> {
  try {
    const res = await fetch(`${apiBase()}/share/shorten`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    });
    if (!res.ok) return url;
    const data = (await res.json()) as Partial<ShortLink>;
    return data.url ?? url;
  } catch {
    return url;
  }
}

/**
 * Resolve a short link ID to its credential so the public verification page
 * can run on-chain verification. Returns `null` when the link is unknown or
 * expired.
 */
export async function resolveShortLink(id: string): Promise<ResolvedShortLink | null> {
  try {
    const res = await fetch(`${apiBase()}/share/${encodeURIComponent(id)}`);
    if (!res.ok) return null;
    return (await res.json()) as ResolvedShortLink;
  } catch {
    return null;
  }
}

/** Whether the browser supports the Web Share API (mobile share sheets). */
export function canUseNativeShare(): boolean {
  return typeof navigator !== 'undefined' && typeof navigator.share === 'function';
}

export function trackSocialShare(
  platform: SocialPlatform,
  credential: Pick<Credential, 'id' | 'credentialType'>,
  privacy: SharePrivacyOptions
): void {
  trackShareEvent('credential_social_share', {
    platform,
    credentialType: privacy.includeType ? credential.credentialType : undefined,
    credentialId: privacy.includeIdInAnalytics ? credential.id : undefined,
  });
}

/** Summarize locally recorded social share events by platform. */
export function getSocialShareStats(): Partial<Record<SocialPlatform, number>> {
  try {
    const events = JSON.parse(localStorage.getItem('soroban_share_analytics') || '[]') as {
      event: string;
      properties?: { platform?: SocialPlatform };
    }[];
    const stats: Partial<Record<SocialPlatform, number>> = {};
    for (const e of events) {
      const p = e.event === 'credential_social_share' ? e.properties?.platform : undefined;
      if (p) stats[p] = (stats[p] ?? 0) + 1;
    }
    return stats;
  } catch {
    return {};
  }
}
