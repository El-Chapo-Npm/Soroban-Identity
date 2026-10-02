import type { Credential } from '../../../sdk/src/types';
import { trackShareEvent } from './credentialCrypto';

export type SocialPlatform = 'twitter' | 'linkedin' | 'whatsapp' | 'native' | 'copy';

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
export function buildPlatformUrl(platform: 'twitter' | 'linkedin' | 'whatsapp', url: string, text: string): string {
  switch (platform) {
    case 'twitter':
      return `https://twitter.com/intent/tweet?${new URLSearchParams({ text, url, hashtags: 'SorobanIdentity,Stellar' })}`;
    case 'linkedin':
      return `https://www.linkedin.com/sharing/share-offsite/?${new URLSearchParams({ url })}`;
    case 'whatsapp':
      return `https://wa.me/?${new URLSearchParams({ text: `${text} ${url}` })}`;
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
