// Dependency-free HMAC-SHA256 verifier for webhook deliveries.
//
// The server signs using Node's node:crypto; here we rely on the
// WebCrypto SubtleCrypto API so the same code works in browsers,
// service workers, Node 20+, Deno, and edge runtimes. Consumers
// typically integrate this as an HTTP middleware:
//
//   const body = await req.text();
//   const ok = await verifyWebhookSignature({
//     secret: process.env.CEPAGE_WEBHOOK_SECRET!,
//     body,
//     header: req.headers.get('cepage-signature'),
//   });
//   if (!ok) return new Response('bad signature', { status: 401 });
//
// The header format mirrors Stripe's "v1,t=...,sig=..." scheme so
// existing verifiers need only a small shim.

export interface ParsedSignature {
  scheme: 'v1';
  timestamp: number;
  signature: string;
}

export function parseWebhookSignatureHeader(
  header: string | null | undefined,
): ParsedSignature | null {
  if (!header) return null;
  let scheme: 'v1' | null = null;
  let timestamp: number | null = null;
  let signature: string | null = null;
  for (const part of header.split(',').map((s) => s.trim())) {
    if (part === 'v1') {
      scheme = 'v1';
      continue;
    }
    const eq = part.indexOf('=');
    if (eq <= 0) continue;
    const key = part.slice(0, eq);
    const value = part.slice(eq + 1);
    if (key === 't') timestamp = Number.parseInt(value, 10);
    else if (key === 'sig') signature = value;
  }
  if (!scheme || !signature || !Number.isFinite(timestamp ?? NaN)) return null;
  return { scheme, timestamp: timestamp as number, signature };
}

export interface VerifyWebhookOptions {
  secret: string;
  body: string;
  header: string | null | undefined;
  /** Reject deliveries older than this many seconds. Default: 300 (5 min). */
  toleranceSec?: number;
  /** Override `now` (unix seconds) for deterministic tests. */
  now?: number;
}

export async function verifyWebhookSignature(
  options: VerifyWebhookOptions,
): Promise<boolean> {
  const parsed = parseWebhookSignatureHeader(options.header);
  if (!parsed) return false;
  const tolerance = options.toleranceSec ?? 300;
  const now = options.now ?? Math.floor(Date.now() / 1000);
  if (Math.abs(now - parsed.timestamp) > tolerance) return false;

  const signed = `${parsed.timestamp}.${options.body}`;
  const expected = await computeHmacHex(options.secret, signed);
  return constantTimeEqual(expected, parsed.signature);
}

async function computeHmacHex(secret: string, body: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const mac = await crypto.subtle.sign('HMAC', key, encoder.encode(body));
  return toHex(new Uint8Array(mac));
}

function toHex(bytes: Uint8Array): string {
  let out = '';
  for (const byte of bytes) {
    out += byte.toString(16).padStart(2, '0');
  }
  return out;
}

/**
 * Constant-time compare of two equal-length hex strings. Returns
 * `false` immediately when the lengths differ; otherwise the XOR-
 * accumulator guarantees the loop runs for every byte regardless of
 * the input.
 */
function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i += 1) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}
