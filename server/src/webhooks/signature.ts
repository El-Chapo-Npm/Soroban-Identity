import { createHmac, timingSafeEqual } from "node:crypto";

export const WEBHOOK_SIGNATURE_HEADER = "X-Signature";
export const WEBHOOK_TIMESTAMP_HEADER = "X-Signature-Timestamp";
export const WEBHOOK_KEY_ID_HEADER = "X-Signature-Key-Id";

export function normalizeWebhookPayload(payload: unknown): string {
  if (typeof payload === "string") {
    return payload;
  }
  if (Buffer.isBuffer(payload)) {
    return payload.toString("utf8");
  }
  return JSON.stringify(payload ?? {});
}

export function generateWebhookSignature({
  payload,
  secret,
  timestamp,
}: {
  payload: unknown;
  secret: string;
  timestamp?: number;
}): string {
  const now = timestamp ?? Math.floor(Date.now() / 1000);
  const normalized = normalizeWebhookPayload(payload);
  const signed = `${now}.${normalized}`;
  return createHmac("sha256", secret).update(signed).digest("hex");
}

export function signWebhookRequest({
  payload,
  secret,
  keyId = "default",
  timestamp,
}: {
  payload: unknown;
  secret: string;
  keyId?: string;
  timestamp?: number;
}): Record<string, string> {
  const now = timestamp ?? Math.floor(Date.now() / 1000);
  const signature = generateWebhookSignature({
    payload,
    secret,
    timestamp: now,
  });
  return {
    [WEBHOOK_SIGNATURE_HEADER]: `sha256=${signature}`,
    [WEBHOOK_TIMESTAMP_HEADER]: String(now),
    [WEBHOOK_KEY_ID_HEADER]: keyId,
  };
}

export function verifyWebhookSignature({
  payload,
  secret,
  signature,
  timestamp,
  toleranceSec = 300,
}: {
  payload: unknown;
  secret: string;
  signature: string | null | undefined;
  timestamp: number | string;
  toleranceSec?: number;
}): boolean {
  if (!signature || !secret) return false;

  const ts = Number(timestamp);
  const now = Math.floor(Date.now() / 1000);
  if (!Number.isFinite(ts) || Math.abs(now - ts) > toleranceSec) {
    return false;
  }

  const expected = generateWebhookSignature({ payload, secret, timestamp: ts });
  const provided = signature.replace(/^sha256=/, "").trim();
  const expectedBuffer = Buffer.from(expected, "hex");
  const providedBuffer = Buffer.from(provided, "hex");

  if (expectedBuffer.length !== providedBuffer.length) {
    return false;
  }

  return timingSafeEqual(expectedBuffer, providedBuffer);
}

export default {
  WEBHOOK_SIGNATURE_HEADER,
  WEBHOOK_TIMESTAMP_HEADER,
  WEBHOOK_KEY_ID_HEADER,
  generateWebhookSignature,
  signWebhookRequest,
  verifyWebhookSignature,
};
