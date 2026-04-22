import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

// Standalone utilities for signing/verifying webhook payloads.
//
// Signature format (header `Cepage-Signature`):
//
//   v1,t=<unixSeconds>,sig=<hexHmacSha256>
//
// The signed string is `t.body` (dot-joined), matching Stripe's
// approach closely enough that any existing verifier library can be
// adapted in ~10 LOC. We include the timestamp in the signed content
// so replay-attacks require the attacker to also grind the t= value;
// consumers should additionally reject deliveries older than a
// configurable window (default 5 min). A single `toleranceSec` guard
// is provided here for server-side tests and other internal uses.
//
// We deliberately expose the low-level primitives so the CLI, the
// Python SDK, and future external integrations can all share them.

export interface WebhookSignatureParts {
  scheme: 'v1';
  timestamp: number;
  signature: string;
}

export interface SignPayloadOptions {
  secret: string;
  body: string;
  /** Unix seconds override — useful in tests. Defaults to Date.now(). */
  timestamp?: number;
}

export function signPayload(options: SignPayloadOptions): {
  header: string;
  timestamp: number;
  signature: string;
} {
  const timestamp = options.timestamp ?? Math.floor(Date.now() / 1000);
  const signed = `${timestamp}.${options.body}`;
  const mac = createHmac('sha256', options.secret);
  mac.update(signed);
  const signature = mac.digest('hex');
  return {
    header: `v1,t=${timestamp},sig=${signature}`,
    timestamp,
    signature,
  };
}

export function parseSignatureHeader(header: string | undefined | null): WebhookSignatureParts | null {
  if (!header) return null;
  const parts = header.split(',').map((p) => p.trim());
  let scheme: 'v1' | null = null;
  let timestamp: number | null = null;
  let signature: string | null = null;
  for (const part of parts) {
    if (part === 'v1') {
      scheme = 'v1';
      continue;
    }
    const [rawKey, ...rest] = part.split('=');
    if (!rawKey || rest.length === 0) continue;
    const value = rest.join('=');
    if (rawKey === 't') timestamp = Number.parseInt(value, 10);
    else if (rawKey === 'sig') signature = value;
  }
  if (!scheme || !signature || !Number.isFinite(timestamp ?? NaN)) {
    return null;
  }
  return { scheme, timestamp: timestamp as number, signature };
}

export interface VerifySignatureOptions {
  secret: string;
  body: string;
  header: string | null | undefined;
  /** Reject deliveries older than this many seconds. Default: 300 (5 min). */
  toleranceSec?: number;
  /** Override `now` (unix seconds) for deterministic tests. */
  now?: number;
}

export function verifySignature(options: VerifySignatureOptions): boolean {
  const parsed = parseSignatureHeader(options.header);
  if (!parsed) return false;
  const tolerance = options.toleranceSec ?? 300;
  const now = options.now ?? Math.floor(Date.now() / 1000);
  if (Math.abs(now - parsed.timestamp) > tolerance) return false;

  const signed = `${parsed.timestamp}.${options.body}`;
  const mac = createHmac('sha256', options.secret);
  mac.update(signed);
  const expected = mac.digest('hex');

  const expectedBuf = Buffer.from(expected, 'hex');
  const givenBuf = Buffer.from(parsed.signature, 'hex');
  if (expectedBuf.length !== givenBuf.length) return false;
  return timingSafeEqual(expectedBuf, givenBuf);
}

export function generateSecret(byteLength = 32): string {
  return `whsec_${randomBytes(byteLength).toString('base64url')}`;
}
