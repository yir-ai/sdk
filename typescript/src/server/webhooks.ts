const DEFAULT_WEBHOOK_TOLERANCE_SECONDS = 300;
const WEBHOOK_SECRET_PATTERN = /^yir_whsec_[A-Za-z0-9_-]{43}$/;
const WEBHOOK_SIGNATURE_PATTERN = /^v1=[A-Za-z0-9+/]{43}=$/;

export type WebhookVerificationFailureReason =
  | "invalid_secret"
  | "missing_header"
  | "invalid_timestamp"
  | "timestamp_outside_tolerance"
  | "invalid_signature";

export type WebhookVerificationResult =
  | { readonly valid: true; readonly timestamp: number }
  | { readonly valid: false; readonly reason: WebhookVerificationFailureReason };

export interface VerifyWebhookSignatureRequest {
  /** Account-scoped secret revealed from Yir. Never use a Yir API key here. */
  readonly secret: string;
  readonly id: string;
  readonly timestamp: string;
  readonly signature: string;
  /** Exact request bytes captured before JSON parsing or re-serialization. */
  readonly rawBody: Uint8Array;
  /** Maximum accepted clock difference in seconds. Defaults to five minutes. */
  readonly toleranceSeconds?: number;
  /** Epoch seconds, injectable for tests. */
  readonly now?: number;
}

/**
 * Verifies a Yir Standard webhook using its raw request bytes.
 * Replay deduplication by webhook ID remains the receiver's responsibility.
 */
export async function verifyWebhookSignature(
  request: VerifyWebhookSignatureRequest,
): Promise<WebhookVerificationResult> {
  if (!WEBHOOK_SECRET_PATTERN.test(request.secret)) {
    return { valid: false, reason: "invalid_secret" };
  }
  if (!request.id || !request.timestamp || !request.signature) {
    return { valid: false, reason: "missing_header" };
  }

  const timestamp = parseTimestamp(request.timestamp);
  if (timestamp === null) {
    return { valid: false, reason: "invalid_timestamp" };
  }
  const toleranceSeconds = request.toleranceSeconds ?? DEFAULT_WEBHOOK_TOLERANCE_SECONDS;
  if (!Number.isSafeInteger(toleranceSeconds) || toleranceSeconds < 0) {
    throw new RangeError("toleranceSeconds must be a non-negative safe integer");
  }
  const now = request.now ?? Math.floor(Date.now() / 1000);
  if (!Number.isSafeInteger(now) || now < 0) {
    throw new RangeError("now must be a non-negative epoch second");
  }
  if (Math.abs(now - timestamp) > toleranceSeconds) {
    return { valid: false, reason: "timestamp_outside_tolerance" };
  }
  if (!WEBHOOK_SIGNATURE_PATTERN.test(request.signature)) {
    return { valid: false, reason: "invalid_signature" };
  }

  const expected = await signWebhook(request.secret, request.timestamp, request.id, request.rawBody);
  return constantTimeEqual(expected, request.signature)
    ? { valid: true, timestamp }
    : { valid: false, reason: "invalid_signature" };
}

function parseTimestamp(value: string): number | null {
  if (!/^(0|[1-9][0-9]*)$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

async function signWebhook(
  secret: string,
  timestamp: string,
  id: string,
  rawBody: Uint8Array,
): Promise<string> {
  const encoder = new TextEncoder();
  const prefix = encoder.encode(`${timestamp}.${id}.`);
  const message = new Uint8Array(prefix.length + rawBody.length);
  message.set(prefix);
  message.set(rawBody, prefix.length);

  const key = await globalThis.crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const digest = new Uint8Array(await globalThis.crypto.subtle.sign("HMAC", key, message));
  return `v1=${bytesToBase64(digest)}`;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return globalThis.btoa(binary);
}

function constantTimeEqual(left: string, right: string): boolean {
  const length = Math.max(left.length, right.length);
  let difference = left.length ^ right.length;
  for (let index = 0; index < length; index += 1) {
    difference |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0);
  }
  return difference === 0;
}
