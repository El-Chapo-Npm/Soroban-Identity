/**
 * Helpers for the indexer API used by claim badges (#1353), the audit log
 * viewer (#1354) and shareable verification links (#1356).
 */
export type ClaimStatus = "verified" | "pending" | "unverified";

export type IdentityEventType = "create" | "update" | "revoke";

export interface IdentityEvent {
  id: string;
  type: IdentityEventType;
  did: string;
  timestamp: number; // unix seconds
  txHash?: string;
  details?: string;
}

export function getIndexerBaseUrl(): string {
  const env = import.meta.env as Record<string, string | undefined>;
  return (env.VITE_INDEXER_URL || env.VITE_SERVER_URL || "/api").replace(/\/$/, "");
}

export function toDid(addressOrDid: string): string {
  return addressOrDid.startsWith("did:") ? addressOrDid : `did:stellar:${addressOrDid}`;
}

export async function fetchClaimStatuses(
  did: string,
  signal?: AbortSignal,
): Promise<Record<string, ClaimStatus>> {
  const res = await fetch(`${getIndexerBaseUrl()}/identities/${encodeURIComponent(toDid(did))}/claims`, { signal });
  if (!res.ok) throw new Error(`Claim status request failed (${res.status})`);
  const body = (await res.json()) as
    | Record<string, ClaimStatus | boolean>
    | { claims?: Array<{ key: string; verified?: boolean; status?: ClaimStatus }> };
  const out: Record<string, ClaimStatus> = {};
  if (Array.isArray((body as { claims?: unknown }).claims)) {
    for (const c of (body as { claims: Array<{ key: string; verified?: boolean; status?: ClaimStatus }> }).claims) {
      out[c.key] = c.status ?? (c.verified ? "verified" : "pending");
    }
  } else {
    for (const [k, v] of Object.entries(body)) {
      out[k] = typeof v === "boolean" ? (v ? "verified" : "pending") : (v as ClaimStatus);
    }
  }
  return out;
}

export async function fetchIdentityEvents(did: string, signal?: AbortSignal): Promise<IdentityEvent[]> {
  const res = await fetch(`${getIndexerBaseUrl()}/identities/${encodeURIComponent(toDid(did))}/events`, { signal });
  if (!res.ok) throw new Error(`Audit log request failed (${res.status})`);
  const body = (await res.json()) as IdentityEvent[] | { events?: IdentityEvent[] };
  const events = Array.isArray(body) ? body : body.events ?? [];
  return events
    .filter((e) => e.type === "create" || e.type === "update" || e.type === "revoke")
    .sort((a, b) => b.timestamp - a.timestamp);
}

export const VERIFY_PATH_PREFIX = "/verify/";

/** Builds a short shareable link such as `https://app/verify/did:stellar:G...`. */
export function buildIdentityVerifyLink(did: string, origin: string = window.location.origin): string {
  return `${origin.replace(/\/$/, "")}${VERIFY_PATH_PREFIX}${encodeURIComponent(toDid(did))}`;
}

/** Extracts the DID from a `/verify/:did` path, or null if it doesn't match. */
export function parseVerifyPath(pathname: string): string | null {
  const idx = pathname.indexOf(VERIFY_PATH_PREFIX);
  if (idx === -1) return null;
  const raw = pathname.slice(idx + VERIFY_PATH_PREFIX.length).split("/")[0];
  if (!raw) return null;
  try {
    return decodeURIComponent(raw);
  } catch {
    return null;
  }
}
